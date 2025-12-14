import { Injectable } from "@nestjs/common";
import { RagService as CoreRagService } from "@mipyao/ai-service";
import { Readable } from "stream";

@Injectable()
export class RagService {
  constructor(private readonly coreRagService: CoreRagService) {
    console.log("[RAG Service] 依赖注入成功，核心 AI/RAG 引擎已准备就绪。");
  }

  /**
   * 流式查询：代理到 CoreRagService
   * 前端只使用流式接口，所以只保留这个方法
   */
  async streamQuery(query: string): Promise<Readable> {
    return this.coreRagService.streamQuery(query);
  }
}
