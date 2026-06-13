/**
 * Speech API - ASR 调用函数
 */

import { buildUrl } from "@/lib/api";

/**
 * ASR - 语音识别
 * @param audioBlob 音频数据 (WebM/Opus 格式)
 * @returns 识别的文本
 */
export const recognizeSpeech = async (audioBlob: Blob): Promise<string> => {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");

  const response = await fetch(buildUrl("/speech/asr"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ASR 调用失败: ${response.status} - ${errorBody}`);
  }

  const result = await response.json();
  return result.text;
};
