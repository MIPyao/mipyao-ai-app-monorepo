/**
 * Speech Service 配置接口
 */

export interface SpeechConfig {
  /** ASR 配置 */
  asr: {
    /** ASR 服务提供商 */
    provider: "siliconflow" | "openrouter" | "browser";
    /** API Key (browser 不需要) */
    apiKey?: string;
    /** API Base URL */
    baseUrl?: string;
    /** 模型名称 */
    model?: string;
  };

  /** TTS 配置 */
  tts: {
    /** TTS 服务提供商 */
    provider: "siliconflow" | "openrouter";
    /** API Key */
    apiKey?: string;
    /** API Base URL */
    baseUrl?: string;
    /** 模型名称 */
    model?: string;
    /** 音色 */
    voice?: string;
  };
}

/**
 * Load speech service configuration from environment variables.
 *
 * Environment variables used include ASR_PROVIDER, SILICONFLOW_API_KEY, SILICONFLOW_BASE_URL,
 * ASR_MODEL, TTS_PROVIDER, TTS_MODEL, and TTS_VOICE. Missing values are filled with sensible defaults.
 *
 * @returns A `SpeechConfig` populated from environment variables. Missing values default to provider `"siliconflow"`, baseUrl `"https://api.siliconflow.cn/v1"`, ASR model `"FunAudioLLM/SenseVoiceSmall"`, TTS model `"FunAudioLLM/CosyVoice2-0.5B"`, and TTS voice `"FunAudioLLM/CosyVoice2-0.5B:alex"`.
 */
export function loadSpeechConfig(): SpeechConfig {
  return {
    asr: {
      provider:
        (process.env.ASR_PROVIDER as SpeechConfig["asr"]["provider"]) ||
        "siliconflow",
      apiKey: process.env.SILICONFLOW_API_KEY,
      baseUrl:
        process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
      model: process.env.ASR_MODEL || "FunAudioLLM/SenseVoiceSmall",
    },
    tts: {
      provider:
        (process.env.TTS_PROVIDER as SpeechConfig["tts"]["provider"]) ||
        "siliconflow",
      apiKey: process.env.SILICONFLOW_API_KEY,
      baseUrl:
        process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
      model: process.env.TTS_MODEL || "FunAudioLLM/CosyVoice2-0.5B",
      voice: process.env.TTS_VOICE || "FunAudioLLM/CosyVoice2-0.5B:alex",
    },
  };
}
