/**
 * ASR (Automatic Speech Recognition) 接口定义
 */

export interface AsrConfig {
  provider: "siliconflow" | "openrouter";
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AsrResult {
  /** 识别的文本 */
  text: string;
  /** 识别置信度 (0-1) */
  confidence?: number;
  /** 处理时间 (ms) */
  duration?: number;
}

export interface IAsrService {
  /**
   * 将音频转换为文本
   * @param audioBuffer 音频数据 (WebM/Opus 格式)
   * @returns 识别结果
   */
  recognize(audioBuffer: Buffer): Promise<AsrResult>;
}
