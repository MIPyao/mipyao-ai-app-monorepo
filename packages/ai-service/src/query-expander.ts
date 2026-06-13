import { ChatOpenAI } from "@langchain/openai";

const EXPAND_PROMPT = `你是一个搜索查询优化器。根据缺失信息生成更精准的搜索查询。

原始问题: {question}
已找到的信息: {foundInfo}
缺失的信息: {missingInfo}

请生成一个针对"缺失信息"的简短搜索查询。只输出查询文本，不要解释。`;

export class QueryExpander {
  private llm: ChatOpenAI;

  constructor(llm: ChatOpenAI) {
    this.llm = llm;
  }

  async expand(
    query: string,
    missingInfo: string,
    foundInfo: string,
  ): Promise<string> {
    const prompt = EXPAND_PROMPT.replace("{question}", query)
      .replace("{foundInfo}", foundInfo)
      .replace("{missingInfo}", missingInfo);

    const response = await this.llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Clean up: remove quotes, markdown, extra whitespace
    return content.replace(/^["']|["']$/g, "").replace(/`/g, "").trim();
  }
}
