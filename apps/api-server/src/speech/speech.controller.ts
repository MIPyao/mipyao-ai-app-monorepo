/**
 * Speech Controller - ASR 和 TTS 端点
 */

import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Res,
  UploadedFile,
  UseInterceptors,
  Query,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { SpeechService } from "./speech.service";

// 定义上传文件接口（避免依赖 @types/multer）
interface UploadedFileData {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("speech")
@Controller("speech")
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  // ----------------------------------------------------
  // POST /speech/asr - 语音识别
  // ----------------------------------------------------
  @Post("asr")
  @ApiOperation({
    summary: "语音识别 (ASR)",
    description: "上传音频文件，返回识别的文本",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "音频文件 (WebM/Opus 格式)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "识别成功",
    schema: { properties: { text: { type: "string" } } },
  })
  @ApiResponse({ status: 400, description: "无效的音频文件" })
  @ApiResponse({ status: 500, description: "ASR 服务错误" })
  @UseInterceptors(FileInterceptor("file"))
  async recognize(@UploadedFile() file: UploadedFileData) {
    if (!file || !file.buffer) {
      throw new HttpException("请上传音频文件", HttpStatus.BAD_REQUEST);
    }

    // 限制文件大小 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new HttpException(
        "音频文件过大，请限制在 10MB 以内",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const text = await this.speechService.recognize(file.buffer);
      return { text };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new HttpException(
        `语音识别失败: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ----------------------------------------------------
  // POST /speech/tts - 语音合成
  // ----------------------------------------------------
  @Post("tts")
  @ApiOperation({
    summary: "语音合成 (TTS)",
    description: "将文本转换为语音，返回 MP3 音频流",
  })
  @ApiResponse({
    status: 200,
    description: "成功返回音频流",
    content: { "audio/mpeg": {} },
  })
  @ApiResponse({ status: 400, description: "无效的请求" })
  @ApiResponse({ status: 500, description: "TTS 服务错误" })
  async synthesize(
    @Body("text") text: string,
    @Query("stream") streamMode: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!text || text.trim().length === 0) {
      throw new HttpException("文本内容不能为空", HttpStatus.BAD_REQUEST);
    }

    // 限制文本长度 (5000 字符)
    const maxLength = 5000;
    if (text.length > maxLength) {
      throw new HttpException(
        `文本过长，请限制在 ${maxLength} 字符以内`,
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // 流式模式
      if (streamMode === "true") {
        res.set({
          "Content-Type": "audio/mpeg",
          "Transfer-Encoding": "chunked",
          Connection: "keep-alive",
        });

        const stream = this.speechService.synthesizeStream(text);
        for await (const chunk of stream) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      // 完整模式
      const audio = await this.speechService.synthesize(text);

      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length.toString(),
      });

      return audio;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new HttpException(
        `语音合成失败: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
