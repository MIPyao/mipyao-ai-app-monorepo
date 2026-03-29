/**
 * SiliconFlow ASR 实现
 * 使用 FunAudioLLM/SenseVoiceSmall 模型（免费）
 *
 * 注意：SiliconFlow 不支持 WebM 格式，前端会将音频转换为 WAV 格式
 */

import { IAsrService, AsrConfig, AsrResult } from "./asr.interface";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export class SiliconFlowAsrService implements IAsrService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: AsrConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
  }

  async recognize(audioBuffer: Buffer): Promise<AsrResult> {
    const startTime = Date.now();

    // 创建临时文件（WAV 格式）
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `audio_${Date.now()}.wav`);

    try {
      // 写入临时文件
      fs.writeFileSync(tempFile, audioBuffer);

      console.log(
        `[SiliconFlow ASR] 发送请求到 ${this.baseUrl}/audio/transcriptions`,
      );
      console.log(
        `[SiliconFlow ASR] 模型: ${this.model}, 音频大小: ${audioBuffer.length} bytes`,
      );

      // 使用 native FormData 和 File API
      const formData = new FormData();
      formData.append("model", this.model);

      // 读取文件内容并创建 File 对象（WAV 格式）
      const fileBuffer = fs.readFileSync(tempFile);
      const file = new File([fileBuffer], "audio.wav", { type: "audio/wav" });
      formData.append("file", file);

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      const responseText = await response.text();
      console.log(`[SiliconFlow ASR] 响应状态: ${response.status}`);
      console.log(`[SiliconFlow ASR] 响应内容: ${responseText}`);

      if (!response.ok) {
        throw new Error(
          `SiliconFlow ASR API error: ${response.status} - ${responseText}`,
        );
      }

      let result: { text: string };
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(`无法解析响应: ${responseText}`);
      }

      return {
        text: result.text?.trim() || "",
        duration: Date.now() - startTime,
      };
    } catch (error) {
      console.error("[SiliconFlow ASR] Recognition failed:", error);
      throw error;
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // 忽略清理错误
      }
    }
  }
}
