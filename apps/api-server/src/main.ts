import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle("RAG AI Service API") // 设置文档标题
    .setDescription("基于赵耀个人简历的 RAG 问答服务 API 文档") // 设置文档描述
    .setVersion("1.0") // 设置版本
    .addTag("rag", "检索增强生成相关的接口") // 为您的 /rag 接口添加标签
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup("api-docs", app, document);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
