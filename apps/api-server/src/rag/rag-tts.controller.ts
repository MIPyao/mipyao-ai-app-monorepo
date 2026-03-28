/**
 * RAG-TTS Controller - 流式 RAG + TTS 集成
 * 实现 LLM 文本流 + TTS 音频流的串行处理（避免并发问题）
 */

import {
  Controller,
  HttpException,
  HttpStatus,
  Get,
  Query,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { RagService } from "./rag.service";
import { SpeechService } from "../speech/speech.service";

@ApiTags("rag-tts")
@Controller("rag-tts")
export class RagTtsController {
  constructor(
    private readonly ragService: RagService,
    private readonly speechService: SpeechService,
  ) {}

  // ----------------------------------------------------
  // GET /rag-tts/stream - 流式 RAG + TTS
  // ----------------------------------------------------
  @Get("stream")
  @ApiOperation({
    summary: "流式 RAG + TTS 问答",
    description: "同时返回文本流和音频流，实现边生成边朗读",
  })
  @ApiQuery({
    name: "query",
    required: true,
    description: "用户查询",
    example: "赵耀精通哪些技术？",
  })
  @ApiResponse({ status: 200, description: "SSE 流，包含文本和音频" })
  @ApiResponse({ status: 400, description: "无效请求" })
  @ApiResponse({ status: 503, description: "服务不可用" })
  async streamRagWithTts(@Query("query") query: string, @Res() res: Response) {
    if (!query || query.trim().length === 0) {
      throw new HttpException("查询内容不能为空", HttpStatus.BAD_REQUEST);
    }

    console.log(`[RAG-TTS] 接收到流式查询: ${query}`);

    // 设置 SSE 响应头
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // 用于分句的缓冲区
    let textBuffer = "";
    // 跟踪已处理的完整句子（避免重复）
    const processedSentences = new Set<string>();

    try {
      // 获取 RAG 文本流
      const textStream = await this.ragService.streamQuery(query);

      // 使用队列保证顺序处理
      const queue: Array<() => Promise<void>> = [];
      let isProcessing = false;

      const processQueue = async () => {
        if (isProcessing || queue.length === 0) return;
        isProcessing = true;
        try {
          while (queue.length > 0) {
            const task = queue.shift();
            if (task) {
              await task();
            }
          }
        } finally {
          isProcessing = false;
        }
      };

      // 处理文本流 - 将每个 chunk 的处理加入队列
      textStream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        queue.push(async () => {
          textBuffer += text;
          this.sendSSEvent(res, "text", { content: text });

          const sentences = this.extractSentences(textBuffer);
          for (const sentence of sentences.complete) {
            if (processedSentences.has(sentence)) continue;
            processedSentences.add(sentence);

            console.log(
              `[RAG-TTS] TTS request: "${sentence.substring(0, 30)}..."`,
            );
            try {
              const audioBuffer = await this.speechService.synthesize(sentence);
              const audioBase64 = audioBuffer.toString("base64");
              this.sendSSEvent(res, "audio", {
                content: audioBase64,
                sentence: sentence,
              });
            } catch (ttsError) {
              console.error(`[RAG-TTS] TTS 失败:`, ttsError);
              this.sendSSEvent(res, "error", {
                type: "tts",
                message: "语音合成失败，但文本继续显示",
              });
            }
          }
          textBuffer = sentences.remainder;
        });
        processQueue();
      });

      textStream.on("end", async () => {
        queue.push(async () => {
          if (textBuffer.trim() && !processedSentences.has(textBuffer.trim())) {
            try {
              const audioBuffer = await this.speechService.synthesize(
                textBuffer.trim(),
              );
              const audioBase64 = audioBuffer.toString("base64");
              this.sendSSEvent(res, "audio", {
                content: audioBase64,
                sentence: textBuffer.trim(),
              });
            } catch (error) {
              console.error("[RAG-TTS] 最后一句 TTS 失败:", error);
            }
          }
          this.sendSSEvent(res, "done", {});
          res.end();
        });
        await processQueue();
      });

      textStream.on("error", (error) => {
        console.error("[RAG-TTS] 文本流错误:", error);
        this.sendSSEvent(res, "error", {
          type: "rag",
          message: error.message || "RAG 流处理失败",
        });
        res.end();
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[RAG-TTS] 初始化失败:", errorMessage);

      this.sendSSEvent(res, "error", {
        type: "init",
        message: errorMessage,
      });
      res.end();
    }
  }

  /**
   * 发送 SSE 事件
   */
  private sendSSEvent(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * 清理 Markdown 格式，转换为适合 TTS 的纯文本
   */
  private cleanMarkdown(text: string): string {
    return (
      text
        // 替换列表标记 - 为停顿
        .replace(/^[\s]*[-*+]\s+/gm, "、")
        // 替换数字列表 1. 2. 等
        .replace(/^[\s]*\d+\.\s+/gm, "")
        // 替换标题标记
        .replace(/^#{1,6}\s+/gm, "")
        // 去除多余的空格
        .replace(/\s{2,}/g, " ")
        .trim()
    );
  }

  /**
   * 从文本中提取完整句子
   * 支持中文标点：。！？以及换行
   */
  private extractSentences(text: string): {
    complete: string[];
    remainder: string;
  } {
    const sentences: string[] = [];
    const pattern = /([^。！？\n]+[。！？\n])/g;
    let match;
    let lastEndIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      let sentence = match[1].trim();
      // 清理 markdown 格式
      sentence = this.cleanMarkdown(sentence);
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
      lastEndIndex = match.index + match[1].length;
    }

    const remainder = text.slice(lastEndIndex);
    return { complete: sentences, remainder };
  }
}
