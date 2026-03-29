import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SpeechController } from "./speech.controller";
import { SpeechService } from "./speech.service";

@Module({
  imports: [ConfigModule],
  controllers: [SpeechController],
  providers: [SpeechService],
  exports: [SpeechService],
})
export class SpeechModule {}
