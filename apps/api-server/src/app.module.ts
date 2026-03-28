import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { RagModule } from "./rag/rag.module";
import { SpeechModule } from "./speech/speech.module";

@Module({
  imports: [RagModule, SpeechModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
