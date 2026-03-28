/**
 * Speech Service - NestJS 代理服务
 * 封装 @mipyao/speech-service 的调用
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SpeechServiceFactory,
  IAsrService,
  ITtsService,
  SpeechConfig,
  loadSpeechConfig,
} from "@mipyao/speech-service";
import { Readable } from "stream";

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private asrService: IAsrService;
  private ttsService: ITtsService;

  constructor(private readonly configService: ConfigService) {
    // 从环境变量加载配置
    const config = loadSpeechConfig();

    // 创建 ASR 和 TTS 服务实例
    this.asrService = SpeechServiceFactory.createAsrService(config.asr);
    this.ttsService = SpeechServiceFactory.createTtsService(config.tts);

    this.logger.log(
      `Speech service initialized with ASR: ${config.asr.provider}, TTS: ${config.tts.provider}`,
    );
  }

  /**
   * ASR - 语音识别
   * @param audioBuffer 音频数据
   * @returns 识别的文本
   */
  async recognize(audioBuffer: Buffer): Promise<string> {
    try {
      this.logger.log(`ASR processing audio: ${audioBuffer.length} bytes`);
      const result = await this.asrService.recognize(audioBuffer);
      this.logger.log(`ASR result: "${result.text}" (${result.duration}ms)`);
      return result.text;
    } catch (error) {
      this.logger.error("ASR failed:", error);
      throw error;
    }
  }

  /**
   * TTS - 语音合成（完整返回）
   * @param text 要转换的文本
   * @returns 音频数据
   */
  async synthesize(text: string): Promise<Buffer> {
    try {
      this.logger.log(`TTS processing text: "${text.substring(0, 50)}..."`);
      const audio = await this.ttsService.synthesize(text);
      this.logger.log(`TTS generated: ${audio.length} bytes`);
      return audio;
    } catch (error) {
      this.logger.error("TTS failed:", error);
      throw error;
    }
  }

  /**
   * TTS - 语音合成（流式返回）
   * @param text 要转换的文本
   * @returns 音频流
   */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    try {
      this.logger.log(`TTS streaming: "${text.substring(0, 50)}..."`);

      const stream = this.ttsService.synthesizeStream(text);
      for await (const chunk of stream) {
        if (chunk.audio.length > 0) {
          yield chunk.audio;
        }
      }
    } catch (error) {
      this.logger.error("TTS stream failed:", error);
      throw error;
    }
  }
}
