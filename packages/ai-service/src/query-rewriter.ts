import { ChatOpenAI } from "@langchain/openai";

const REWRITE_PROMPT = `你是一个搜索查询优化器。给定用户问题，判断是否需要拆分为多个子查询。

规则：
1. 如果问题是简单的单一主题，返回原始问题（不拆分）
2. 如果问题涉及多个主题或维度，拆分为独立的子查询
3. 每个子查询应该针对一个具体的信息点
4. 子查询应该适合向量检索（简洁、关键词明确）

用户问题: {question}

请返回 JSON 格式（不要输出其他内容）:
{"queries": ["子查询1", "子查询2", ...]}

如果不需要拆分，返回:
{"queries": ["原始问题"]}`;

export class QueryRewriter {
  private llm: ChatOpenAI;

  constructor(llm: ChatOpenAI) {
    this.llm = llm;
  }

  async rewrite(question: string): Promise<string[]> {
    const prompt = REWRITE_PROMPT.replace("{question}", question);

    const response = await this.llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Find first complete JSON object by brace counting
    const startIdx = content.indexOf("{");
    if (startIdx === -1) {
      return [question]; // Fallback to original question
    }

    let braceCount = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === "{") braceCount++;
      if (content[i] === "}") braceCount--;
      if (braceCount === 0) {
        endIdx = i;
        break;
      }
    }

    const jsonStr = content.substring(startIdx, endIdx + 1);

    try {
      const result = JSON.parse(jsonStr);
      if (Array.isArray(result.queries) && result.queries.length > 0) {
        return result.queries;
      }
      return [question]; // Fallback
    } catch {
      return [question]; // Fallback
    }
  }
}
