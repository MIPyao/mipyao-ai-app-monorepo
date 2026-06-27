import { ChatOpenAI } from "@langchain/openai";

export interface SufficiencyResult {
  sufficient: boolean;
  /** 中间草稿：基于现有上下文的试答，缺失处用 [缺失：xxx] 标注 */
  draft: string;
  /**
   * 缺失信息的可检索关键词数组，充分时为空数组。
   * 每个元素应是一个适合向量检索的词或短语（如「性能优化指标」），
   * 直接供第二轮 expand_query 消费。
   */
  missingInfo: string[];
  /** 判断理由 */
  reason: string;
}

/**
 * 充分性检查器（基于"中间草稿"机制）。
 *
 * 与直接问"资料够不够"不同，这里强制 LLM 先写一版草稿答案，
 * 再审视草稿中哪些信息点写不出来（[缺失：xxx]），从而把难以判断的
 * 元认知问题（"信息够不够"）转化为具体动作（"答案写得出来吗"）。
 * 写不出来的地方就是缺失信息，其表述天然适合做二级检索的关键词。
 */
const SUFFICIENCY_PROMPT = `你是一个严谨的信息完整性检查器，工作分两步完成。

【第一步：草稿试答】
基于下面的「检索到的上下文」，尝试为用户问题写一份草稿答案。
要求：
- 必须覆盖用户问题中的每一个信息点（拆解问题的各个子问）。
- 只能使用上下文里出现的信息，禁止编造或使用外部知识。
- 如果某个信息点在上下文中找不到，不要硬编，直接用「[缺失：具体说明]」标注。

【第二步：判断与缺失分析】
审视你刚才写的草稿：
- 若草稿中没有任何「[缺失：具体说明]」标注 → sufficient: true，missingInfo 为空数组 []。
- 若存在任何标注 → sufficient: false，把每个缺失点提炼成一个适合向量检索的关键词或短语（例如「性能优化指标」「项目上线成果」）放入 missingInfo 数组。

请严格按以下 JSON 格式输出（不要输出任何其他内容，不要使用 markdown 代码块）：
{"sufficient": true或false, "draft": "你的草稿答案（含[缺失：xxx]标注）", "missingInfo": ["关键词1", "关键词2"], "reason": "判断理由"}

充分时 missingInfo 为空数组 []；不充分时 missingInfo 至少包含一个可检索关键词。

用户问题:
{question}

检索到的上下文:
{context}`;

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

    return this.parseResult(content);
  }

  /**
   * 从 LLM 输出中解析充分性检查结果。
   * 采用 fail-closed 策略：解析失败一律视为不充分，避免误判为充分而生成幻觉。
   */
  private parseResult(content: string): SufficiencyResult {
    // Find first complete JSON object by brace counting
    const startIdx = content.indexOf("{");
    if (startIdx === -1) {
      // 整段输出没有花括号，连 JSON 结构都不像，直接降级（fallbackExtract 内部会打日志）
      return this.fallbackExtract(content);
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
      const sufficient = Boolean(result.sufficient);
      const missingInfo = this.normalizeMissingInfo(result.missingInfo);

      return {
        sufficient,
        draft: typeof result.draft === "string" ? result.draft : "",
        // 不充分但解析不到关键词时，用 reason 兜底，保证下游 expand_query 有检索词可用
        missingInfo:
          !sufficient && missingInfo.length === 0 && result.reason
            ? [String(result.reason)]
            : missingInfo,
        reason: typeof result.reason === "string" ? result.reason : "",
      };
    } catch {
      // JSON 整体解析失败（通常是 draft 长文本里出现未转义引号/换行/花括号破坏了结构）
      // 降级：用正则单独抢救 sufficient 和 missingInfo，保证核心判断和下游检索不中断
      const fallback = this.fallbackExtract(content);
      console.warn(
        `[SufficiencyChecker] JSON 解析失败，降级提取。原始输出:\n${content}\n降级结果: sufficient=${fallback.sufficient}, missingInfo=${JSON.stringify(fallback.missingInfo)}`,
      );
      return fallback;
    }
  }

  /**
   * JSON 解析失败的降级提取：用正则单独抢出 sufficient 和 missingInfo。
   * draft 抢不出来就放弃（下游 expand_query 不依赖 draft），优先保住核心判断和检索词。
   */
  private fallbackExtract(content: string): SufficiencyResult {
    // 抢 sufficient：匹配 "sufficient": true/false
    const sufficientMatch = content.match(
      /"sufficient"\s*:\s*(true|false)/i,
    );
    const sufficient = sufficientMatch
      ? sufficientMatch[1].toLowerCase() === "true"
      : false; // 抢不到就按不充分处理（fail-closed）

    // 抢 missingInfo：数组形态 ["a","b"] 或单字符串 "a"
    let missingInfo: string[] = [];
    const arrayMatch = content.match(
      /"missingInfo"\s*:\s*\[([^\]]*)\]/i,
    );
    if (arrayMatch) {
      missingInfo = (arrayMatch[1].match(/"([^"]+)"/g) || [])
        .map((s) => s.replace(/"/g, "").trim())
        .filter((s) => s.length > 0);
    }
    if (missingInfo.length === 0) {
      const strMatch = content.match(
        /"missingInfo"\s*:\s*"([^"]+)"/i,
      );
      if (strMatch) missingInfo = [strMatch[1].trim()];
    }

    // 抢不到缺失词且不充分时，用原始输出兜底，保证下游 expand_query 有检索词可用
    if (!sufficient && missingInfo.length === 0) {
      missingInfo = ["检索信息不充分"];
    }

    return {
      sufficient,
      draft: "", // draft 抢不出就放弃，下游不依赖它
      missingInfo,
      reason: `降级提取（JSON 解析失败）`,
    };
  }

  /** 将 missingInfo 规整为字符串数组，兼容 LLM 偶尔返回字符串的情况，过滤空值与冗余空白。 */
  private normalizeMissingInfo(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
    }
    // 兼容：LLM 偶尔会返回单个字符串而非数组
    if (typeof raw === "string" && raw.trim().length > 0) {
      return [raw.trim()];
    }
    return [];
  }
}
