/**
 * Speech Service 工厂
 * 根据配置创建相应的 ASR/TTS 服务实例
 */

import { IAsrService, AsrConfig } from "./asr/asr.interface";
import { SiliconFlowAsrService } from "./asr/siliconflow.asr";
import { ITtsService, TtsConfig } from "./tts/tts.interface";
import { SiliconFlowTtsService } from "./tts/siliconflow.tts";
import { SpeechConfig } from "./speech.config";

export class SpeechServiceFactory {
  /**
   * 创建 ASR 服务实例
   * @param config ASR 配置
   * @returns ASR 服务实例
   */
  static createAsrService(config: SpeechConfig["asr"]): IAsrService {
    switch (config.provider) {
      case "siliconflow":
        return new SiliconFlowAsrService({
          provider: "siliconflow",
          apiKey: config.apiKey || "",
          baseUrl: config.baseUrl || "https://api.siliconflow.cn/v1",
          model: config.model || "FunAudioLLM/SenseVoiceSmall",
        });

      case "openrouter":
        // OpenRouter ASR 使用与 SiliconFlow 相同的 API 格式
        return new SiliconFlowAsrService({
          provider: "openrouter",
          apiKey: config.apiKey || "",
          baseUrl: config.baseUrl || "https://openrouter.ai/api/v1",
          model: config.model || "whisper-1",
        });

      case "browser":
        throw new Error(
          "Browser ASR should be handled in frontend, not backend",
        );

      default:
        throw new Error(`Unsupported ASR provider: ${config.provider}`);
    }
  }

  /**
   * 创建 TTS 服务实例
   * @param config TTS 配置
   * @returns TTS 服务实例
   */
  static createTtsService(config: SpeechConfig["tts"]): ITtsService {
    switch (config.provider) {
      case "siliconflow":
        return new SiliconFlowTtsService({
          provider: "siliconflow",
          apiKey: config.apiKey || "",
          baseUrl: config.baseUrl || "https://api.siliconflow.cn/v1",
          model: config.model || "FunAudioLLM/CosyVoice2-0.5B",
          voice: config.voice,
        });

      case "openrouter":
        // OpenRouter TTS 使用与 SiliconFlow 相同的 API 格式
        return new SiliconFlowTtsService({
          provider: "openrouter",
          apiKey: config.apiKey || "",
          baseUrl: config.baseUrl || "https://openrouter.ai/api/v1",
          model: config.model || "tts-1",
          voice: config.voice,
        });

      default:
        throw new Error(`Unsupported TTS provider: ${config.provider}`);
    }
  }
}
