import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as path from "path";

import { RagController } from "./rag.controller";
import { RagTtsController } from "./rag-tts.controller";
// 引入本地封装的 RagService (它会负责注入 CoreRagService)
import { RagService } from "./rag.service";
// 引入核心库的 RagService 和 RagConfig
import { RagService as CoreRagService, RagConfig } from "@mipyao/ai-service";
// 引入 SpeechModule 以使用 SpeechService
import { SpeechModule } from "../speech/speech.module";

// ----------------------------------------------------
// 1. 定义 Custom Provider Token
// ----------------------------------------------------
// 这是为了让 NestJS 知道在哪里注入配置对象
export const RAG_CONFIG_TOKEN = "RAG_CONFIG";

@Module({
  imports: [
    // 确保 ConfigModule 加载根目录的 .env 文件
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, "..", "..", "..", "..", ".env")],
    }),
    // 导入 SpeechModule 以使用 SpeechService
    SpeechModule,
  ],
  controllers: [RagController, RagTtsController],
  providers: [
    // ----------------------------------------------------
    // 2. Custom Provider: 组装 RagConfig 对象
    // ----------------------------------------------------
    {
      // 提供一个 RagConfig 对象，这是 CoreRagService 需要的参数
      provide: RAG_CONFIG_TOKEN,
      useFactory: (configService: ConfigService): RagConfig => ({
        dbConfig: {
          host: configService.getOrThrow<string>("POSTGRES_HOST"),
          // 使用 { infer: true } 自动解析数字
          port: configService.getOrThrow<number>("POSTGRES_PORT", {
            infer: true,
          }),
          database: configService.getOrThrow<string>("POSTGRES_DATABASE"),
          user: configService.getOrThrow<string>("POSTGRES_USER"),
          password: configService.getOrThrow<string>("POSTGRES_PASSWORD"),
          tableName: configService.getOrThrow<string>("POSTGRES_TABLE_NAME"),
          dimensions: configService.getOrThrow<number>("POSTGRES_DIMENSIONS", {
            infer: true,
          }),
        },
        openrouterConfig: {
          apiKey: configService.getOrThrow<string>("OPENROUTER_API_KEY"),
          baseUrl: configService.getOrThrow<string>("OPENROUTER_BASE_URL"),
          model: configService.getOrThrow<string>("OPENROUTER_MODEL"),
          temperature: parseFloat(
            configService.getOrThrow<string>("OPENROUTER_TEMPERATURE"),
          ),
        },
        siliconflowConfig: {
          apiKey: configService.getOrThrow<string>("SILICONFLOW_API_KEY"),
          baseUrl: configService.getOrThrow<string>("SILICONFLOW_BASE_URL"),
          embeddingModel: configService.getOrThrow<string>(
            "SILICONFLOW_EMBEDDING_MODEL",
          ),
        },
      }),
      inject: [ConfigService], // 依赖 ConfigService
    },
    // ----------------------------------------------------
    // 3. Custom Provider: 实例化 CoreRagService
    // ----------------------------------------------------
    {
      // 告诉 NestJS 如何实例化 CoreRagService (即 @mipyao/ai-service 中的 RagService)
      provide: CoreRagService,
      // useFactory 接收上一步组装好的配置对象
      useFactory: (config: RagConfig) => new CoreRagService(config),
      inject: [RAG_CONFIG_TOKEN], // 依赖 RAG_CONFIG_TOKEN
    },
    // ----------------------------------------------------
    // 4. 本地 RagService (假设它依赖 CoreRagService)
    // ----------------------------------------------------
    // 如果您的本地 RagService 只是一个封装层，它应该依赖 CoreRagService
    RagService,
  ],
  // 导出本地 RagService 供 Controller 或其他模块使用
  exports: [RagService],
})
export class RagModule {}
