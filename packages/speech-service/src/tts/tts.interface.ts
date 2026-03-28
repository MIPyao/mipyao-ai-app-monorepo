/**
 * TTS (Text-to-Speech) 接口定义
 */

export interface TtsConfig {
  provider: "siliconflow" | "openrouter";
  apiKey?: string; // edge-tts 不需要
  baseUrl?: string;
  model?: string;
  voice?: string; // 音色
}

export interface TtsStreamChunk {
  /** 音频数据块 (MP3) */
  audio: Buffer;
  /** 是否是最后一个块 */
  isLast: boolean;
}

export interface ITtsService {
  /**
   * 将文本转换为语音（完整返回）
   * @param text 要转换的文本
   * @returns 音频数据 (MP3)
   */
  synthesize(text: string): Promise<Buffer>;

  /**
   * 将文本转换为语音（流式返回）
   * @param text 要转换的文本
   * @returns 音频流
   */
  synthesizeStream(text: string): AsyncGenerator<TtsStreamChunk>;
}
