# Phase 2: Query Rewriter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add query decomposition capability to the Agent, enabling it to split complex questions into sub-queries before retrieval.

**Architecture:** Add a `QueryRewriter` class that uses LLM to decompose questions and rewrite them for better vector retrieval. Expose it as a `rewrite_query` Agent tool. Update system prompt to instruct Agent when to use it.

**Tech Stack:** LangChain, ChatOpenAI, Zod

---

## File Structure

```
packages/ai-service/src/
├── query-rewriter.ts        # CREATE: QueryRewriter class
├── agent.ts                 # MODIFY: add rewrite_query tool
├── rag.service.ts           # MODIFY: update system prompt
└── index.ts                 # MODIFY: export QueryRewriter
```

---

## Task 1: QueryRewriter Class

**Covers:** [S4]

**Files:**
- Create: `packages/ai-service/src/query-rewriter.ts`

- [ ] **Step 1: Create query-rewriter.ts**

```typescript
// packages/ai-service/src/query-rewriter.ts
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
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/query-rewriter.ts
git commit -m "feat: add QueryRewriter class"
```

---

## Task 2: Rewrite Query Agent Tool

**Covers:** [S4]

**Files:**
- Modify: `packages/ai-service/src/agent.ts`

- [ ] **Step 1: Add rewrite_query tool to agent.ts**

Add import at top:
```typescript
import { QueryRewriter } from "./query-rewriter";
```

Add inside `createAgentTools` function, after creating other components:
```typescript
const rewriter = new QueryRewriter(llm);
```

Add the tool definition before the return statement:
```typescript
const rewriteTool = tool(
  async ({ question }) => {
    console.log(`   🔄 [rewrite] 分析问题: "${question}"`);
    const queries = await rewriter.rewrite(question);
    console.log(`   🔄 [rewrite] 拆分为 ${queries.length} 个子查询: ${queries.map(q => `"${q}"`).join(", ")}`);
    return JSON.stringify({ queries });
  },
  {
    name: "rewrite_query",
    description:
      "将复杂问题拆分为多个子查询，用于分别检索。简单问题会直接返回原始问题。",
    schema: z.object({
      question: z.string().describe("用户原始问题"),
    }),
  },
);
```

Update `AgentTools` interface:
```typescript
export interface AgentTools {
  rewriteTool: DynamicStructuredTool;
  retrieveTool: DynamicStructuredTool;
  rerankTool: DynamicStructuredTool;
  checkTool: DynamicStructuredTool;
  expandTool: DynamicStructuredTool;
}
```

Update return statement:
```typescript
return { rewriteTool, retrieveTool, rerankTool, checkTool, expandTool };
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/agent.ts
git commit -m "feat: add rewrite_query Agent tool"
```

---

## Task 3: Update System Prompt

**Covers:** [S5]

**Files:**
- Modify: `packages/ai-service/src/rag.service.ts`

- [ ] **Step 1: Update AGENT_SYSTEM_PROMPT**

Find the tools list in the prompt and add rewrite_query:
```
你现在有以下工具可用：
- rewrite_query: 将复杂问题拆分为多个子查询
- retrieve: 从简历数据库检索信息
- rerank: 对检索结果重排序
- check_sufficiency: 检查信息是否充分
- expand_query: 生成更精准的搜索查询
```

Update the workflow section:
```
工作流程：
1. 如果问题涉及多个主题（如"做过什么项目？用过什么技术？"），先调用 rewrite_query 拆分
2. 对每个子查询调用 retrieve 检索
3. 合并所有检索结果
4. 调用 rerank 精排
5. 调用 check_sufficiency 检查
6. 如果不充分，用 expand_query 迭代（最多 2 轮）
7. 信息充分后生成回答
```

- [ ] **Step 2: Update tools array in initializeAgent**

```typescript
this.agent = createReactAgent({
  llm,
  tools: [
    tools.rewriteTool,      // NEW
    tools.retrieveTool,
    tools.rerankTool,
    tools.checkTool,
    tools.expandTool,
  ],
  messageModifier: AGENT_SYSTEM_PROMPT,
});
```

- [ ] **Step 3: Build to verify**

```bash
pnpm build:libs
```

Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add packages/ai-service/src/rag.service.ts
git commit -m "feat: integrate rewrite_query into Agent workflow"
```

---

## Task 4: Export and Final Build

**Covers:** [S6]

**Files:**
- Modify: `packages/ai-service/src/index.ts`

- [ ] **Step 1: Update index.ts exports**

```typescript
export { RagService } from "./rag.service";
export { RagConfig } from "./rag.config";
export { SiliconFlowReranker } from "./reranker";
export { SufficiencyChecker, SufficiencyResult } from "./sufficiency-checker";
export { QueryExpander } from "./query-expander";
export { QueryRewriter } from "./query-rewriter";
```

- [ ] **Step 2: Full build**

```bash
pnpm build:libs
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/index.ts
git commit -m "chore: export QueryRewriter"
```

---

## Task 5: Integration Test

**Covers:** [S8]

- [ ] **Step 1: Start services**

```bash
pnpm dev
```

- [ ] **Step 2: Test simple query (no rewrite)**

Ask: "赵耀的学历是什么？"
Expected: Agent skips rewrite_query, goes directly to retrieve

- [ ] **Step 3: Test complex query (with rewrite)**

Ask: "赵耀做过哪些项目？用过什么技术？"
Expected: Agent calls rewrite_query → ["赵耀的项目经历", "赵耀的技术栈"] → retrieve for each

- [ ] **Step 4: Verify console logs**

Look for:
```
🔄 [rewrite] 分析问题: "赵耀做过哪些项目？用过什么技术？"
🔄 [rewrite] 拆分为 2 个子查询: "赵耀的项目经历", "赵耀的技术栈"
🔍 [retrieve] 搜索: "赵耀的项目经历"
🔍 [retrieve] 搜索: "赵耀的技术栈"
```
