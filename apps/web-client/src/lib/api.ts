const BASE_URL: string =
  process.env.NEXT_PUBLIC_NESTJS_API_BASE_URL || "http://localhost:3000";

/**
 * 构造完整的 API URL，并处理查询参数。
 * @param path API 路径，例如 '/rag/stream'
 * @param params URL 查询参数对象 { query: '...' }
 * @returns 完整的 URL 字符串
 */
export const buildUrl = (
  path: string,
  params: Record<string, any> = {},
): string => {
  const url = new URL(path, BASE_URL);

  // 将查询参数添加到 URL
  Object.keys(params).forEach((key) => {
    if (params[key] !== undefined) {
      // 使用 searchParams.append 自动处理 URL 编码
      url.searchParams.append(key, params[key]);
    }
  });

  return url.toString();
};
