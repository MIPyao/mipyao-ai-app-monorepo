import {
  Controller,
  HttpException,
  HttpStatus,
  Get,
  Query,
  StreamableFile,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { RagService } from "./rag.service";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";

@ApiTags("rag")
@Controller("rag")
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // ----------------------------------------------------
  // GET /stream (流式方法) - 前端唯一使用的接口
  // ----------------------------------------------------
  @Get("stream")
  @ApiOperation({
    summary: "流式 RAG 问答",
    description:
      "流式传输 (Readable Stream) 基于向量数据库知识的 LLM 回答，用于优化用户体验。",
  })
  @ApiQuery({
    name: "query",
    required: true,
    description: "用户提交给 RAG 服务的查询问题",
    example: "赵耀精通哪些技术？",
  })
  @ApiResponse({
    status: 200,
    // 因为是流式输出，Swagger 无法定义具体的 DTO 结构，我们描述其 Content-Type
    description: "成功返回纯文本流，Content-Type: text/plain",
  })
  @ApiResponse({ status: 503, description: "AI 服务或配置错误" })
  async getRagStream(
    @Query("query") query: string,
    // 允许 NestJS 在返回 StreamableFile 后继续控制响应头
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!query || query.trim().length === 0) {
      throw new HttpException("查询内容不能为空", HttpStatus.BAD_REQUEST);
    }

    console.log(`[API] 接收到流式查询: ${query}`);

    try {
      // 1. 调用 RagService，获取 Node.js Readable Stream
      // 我们假设 RagService.streamQuery() 现在返回 Promise<Readable>
      const readableStream = await this.ragService.streamQuery(query);

      // 2. 设置响应头：告知客户端这是纯文本块传输
      res.set({
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked", // 启用分块传输
        Connection: "keep-alive",
      });

      // 3. 将 Readable Stream 封装成 StreamableFile 并返回
      // NestJS 会自动将其 pipe 到 HTTP 响应中
      return new StreamableFile(readableStream);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("RAG Stream API 错误:", errorMessage);
      // 返回 SERVICE_UNAVAILABLE 状态码，表示 AI 服务层存在问题
      throw new HttpException(
        "AI 服务处理失败，请检查 OpenRouter/SiliconFlow API 配置和后端日志。",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
