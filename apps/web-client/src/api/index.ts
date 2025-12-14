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

// ----------------------------------------------------
// (示例：未来您可以这样添加非流式请求)
// ----------------------------------------------------
/*
export const getNewsList = async (): Promise<NewsItem[]> => {
    const fullUrl = buildUrl('/api/news');
    const response = await fetch(fullUrl);
    
    if (!response.ok) {
        throw new Error('获取新闻列表失败');
    }
    return response.json();
}
*/
