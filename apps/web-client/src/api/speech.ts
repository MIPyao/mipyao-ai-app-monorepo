/**
 * Speech API - ASR 和 TTS 调用函数
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

/**
 * TTS - 语音合成（完整模式）
 * @param text 要转换的文本
 * @returns 音频 Blob
 */
export const synthesizeSpeech = async (text: string): Promise<Blob> => {
  const response = await fetch(buildUrl("/speech/tts"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TTS 调用失败: ${response.status} - ${errorBody}`);
  }

  return response.blob();
};

/**
 * TTS - 语音合成（流式模式）
 * @param text 要转换的文本
 * @returns Response 对象（音频流）
 */
export const synthesizeSpeechStream = async (
  text: string,
): Promise<Response> => {
  const response = await fetch(buildUrl("/speech/tts", { stream: "true" }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TTS 流式调用失败: ${response.status} - ${errorBody}`);
  }

  return response;
};
