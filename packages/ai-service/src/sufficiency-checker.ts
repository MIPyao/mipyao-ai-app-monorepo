import { ChatOpenAI } from "@langchain/openai";

export interface SufficiencyResult {
  sufficient: boolean;
  missingInfo: string;
  reason: string;
}

const SUFFICIENCY_PROMPT = `你是一个信息完整性检查器。给定用户问题和检索到的上下文，判断信息是否足以回答问题。

用户问题:
{question}

检索到的上下文:
{context}

请严格按以下 JSON 格式输出（不要输出其他内容）:
{"sufficient": true或false, "missingInfo": "缺失的具体信息描述，如果充分则为空字符串", "reason": "判断理由"}

只输出 JSON，不要输出其他任何内容。`;

export class SufficiencyChecker {
  private llm: ChatOpenAI;

  constructor(llm: ChatOpenAI) {
    this.llm = llm;
  }

  async check(query: string, context: string): Promise<SufficiencyResult> {
    const prompt = SUFFICIENCY_PROMPT.replace("{question}", query).replace(
      "{context}",
      context,
    );

    const response = await this.llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Find first complete JSON object by brace counting
    const startIdx = content.indexOf("{");
    if (startIdx === -1) {
      return {
        sufficient: false,
        missingInfo: "无法解析检查结果",
        reason: "LLM 返回格式异常",
      };
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
      return {
        sufficient: Boolean(result.sufficient),
        missingInfo: result.missingInfo || "",
        reason: result.reason || "",
      };
    } catch {
      return {
        sufficient: false,
        missingInfo: "JSON 解析失败",
        reason: content,
      };
    }
  }
}