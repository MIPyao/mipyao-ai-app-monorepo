import { buildUrl } from "@/lib/api";
/**
 * 执行流式 RAG 问答请求。
 * @param query 用户的问题字符串
 * @returns 浏览器的 Response 对象，包含 ReadableStream
 */
export const streamRagQuery = async (query: string): Promise<Response> => {
  if (!query) {
    throw new Error("Query cannot be empty.");
  }

  // 1. URL 构造：使用统一的构建函数
  const fullUrl = buildUrl("/rag/stream", { query });

  // 2. 核心 fetch 调用
  const response = await fetch(fullUrl, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    // 统一的错误处理
    const errorBody = await response.text();
    throw new Error(`RAG API 调用失败: ${response.status} - ${errorBody}`);
  }

  return response;
};

// Speech API
export {
  recognizeSpeech,
  synthesizeSpeech,
  synthesizeSpeechStream,
} from "./speech";

// RAG-TTS API
export { streamRagTtsQuery } from "./rag-tts";
export type { RagTtsEvent, RagTtsEventCallback } from "./rag-tts";
