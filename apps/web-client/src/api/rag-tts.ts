/**
 * RAG-TTS API - 流式 RAG + TTS 调用
 */

import { buildUrl } from "@/lib/api";

export interface RagTtsEvent {
  event: "text" | "audio" | "error" | "done";
  data: {
    content?: string;
    sentence?: string;
    type?: string;
    message?: string;
  };
}

export type RagTtsEventCallback = (event: RagTtsEvent) => void;

/**
 * 流式 RAG + TTS 查询
 * @param query 用户查询
 * @param onEvent 事件回调
 * @returns 取消函数
 */
export const streamRagTtsQuery = (
  query: string,
  onEvent: RagTtsEventCallback,
): (() => void) => {
  if (!query) {
    throw new Error("Query cannot be empty.");
  }

  const url = buildUrl("/rag-tts/stream", { query });
  const eventSource = new EventSource(url);

  eventSource.addEventListener("text", (e) => {
    onEvent({
      event: "text",
      data: JSON.parse(e.data),
    });
  });

  eventSource.addEventListener("audio", (e) => {
    onEvent({
      event: "audio",
      data: JSON.parse(e.data),
    });
  });

  eventSource.addEventListener("error", (e: Event) => {
    const messageEvent = e as MessageEvent;
    const data = messageEvent.data
      ? JSON.parse(messageEvent.data)
      : { message: "Unknown error" };
    onEvent({
      event: "error",
      data,
    });
    eventSource.close();
  });

  eventSource.addEventListener("done", () => {
    onEvent({
      event: "done",
      data: {},
    });
    eventSource.close();
  });

  eventSource.onerror = (e) => {
    console.error("EventSource error:", e);
    onEvent({
      event: "error",
      data: { type: "connection", message: "连接中断" },
    });
    eventSource.close();
  };

  // 返回取消函数
  return () => {
    eventSource.close();
  };
};
