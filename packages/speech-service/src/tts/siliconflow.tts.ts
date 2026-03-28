/**
 * SiliconFlow TTS 实现
 * 使用 fish-speech 模型
 */

import { ITtsService, TtsConfig, TtsStreamChunk } from "./tts.interface";

export class SiliconFlowTtsService implements ITtsService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly voice?: string;

  constructor(config: TtsConfig) {
    this.apiKey = config.apiKey || "";
    this.baseUrl = config.baseUrl || "https://api.siliconflow.cn/v1";
    this.model = config.model || "fishaudio/fish-speech-1.4";
    this.voice = config.voice;
  }

  async synthesize(text: string): Promise<Buffer> {
    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: this.voice,
          response_format: "mp3",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `SiliconFlow TTS API error: ${response.status} - ${errorText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error("[SiliconFlow TTS] Synthesis failed:", error);
      throw error;
    }
  }

  async *synthesizeStream(text: string): AsyncGenerator<TtsStreamChunk> {
    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: this.voice,
          response_format: "mp3",
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(
          `SiliconFlow TTS API error: ${response.status} - ${errorText}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          yield { audio: Buffer.alloc(0), isLast: true };
          break;
        }

        // 将 Uint8Array 转换为 Buffer
        yield { audio: Buffer.from(value), isLast: false };
      }
    } catch (error) {
      console.error("[SiliconFlow TTS] Stream synthesis failed:", error);
      throw error;
    }
  }
}
