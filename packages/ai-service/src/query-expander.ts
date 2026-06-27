import { ChatOpenAI } from "@langchain/openai";

const EXPAND_PROMPT = `你是一个搜索查询优化器。根据缺失的关键词，针对这些缺失点生成精准的搜索查询。

原始问题: {question}
已找到的信息: {foundInfo}
仍缺失的关键词: {missingKeywords}

规则：
1. 针对每一个缺失的关键词，生成一个适合向量检索的简短查询（聚焦、关键词明确）。
2. 每个查询只针对一个缺失点，不要合并多个不相关概念。
3. 只输出查询文本，每行一个查询，不要编号、不要解释、不要 markdown。

示例输出：
项目性能优化指标
上线后业务成果数据`;

export class QueryExpander {
  private llm: ChatOpenAI;

  constructor(llm: ChatOpenAI) {
    this.llm = llm;
  }

  /**
   * 根据缺失的可检索关键词生成定向查询。
   *
   * @param query 用户原始问题
   * @param missingInfo 缺失关键词数组（来自 check_sufficiency 的 missingInfo）
   * @param foundInfo 已找到的信息
   * @returns 生成的新查询字符串。多个缺失点时合并为一条用空格分隔的查询，
   *          便于单次 retrieve 同时覆盖；失败时回退到原始缺失关键词拼接。
   */
  async expand(
    query: string,
    missingInfo: string[],
    foundInfo: string,
  ): Promise<string> {
    const missingKeywords = missingInfo.join("、");
    const prompt = EXPAND_PROMPT.replace("{question}", query)
      .replace("{foundInfo}", foundInfo)
      .replace("{missingKeywords}", missingKeywords);

    try {
      const response = await this.llm.invoke(prompt);
      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const queries = content
        .split("\n")
        .map((line) => line.replace(/^["'\-\*\d.\s]+|["']$/g, "").trim())
        .filter((line) => line.length > 0);

      if (queries.length === 0) {
        return missingKeywords || query;
      }
      // 多个定向查询合并为一条用空格分隔的检索串，单次 retrieve 即可覆盖所有缺失点
      return queries.join(" ");
    } catch (error) {
      console.error("QueryExpander error:", error);
      return missingKeywords || query;
    }
  }
}
