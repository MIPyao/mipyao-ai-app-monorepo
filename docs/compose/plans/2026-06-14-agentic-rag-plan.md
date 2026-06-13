# Agentic RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade RAG from single-pass retrieval to Agentic RAG with reranking, sufficiency checking, and iterative retrieval using LangChain Agent.

**Architecture:** Replace `RunnableSequence` (LCEL chain) with `createReactAgent` from LangGraph. Agent has 4 tools: retrieve, rerank, checkSufficiency, expandQuery. Agent decides dynamically whether to iterate or generate final answer.

**Tech Stack:** LangChain, LangGraph (`createReactAgent`), SiliconFlow Rerank API, OpenRouter LLM

---

## File Structure

```
packages/ai-service/src/
├── rag.config.ts              # MODIFY: add rerankModel
├── rag.service.ts             # MODIFY: replace chain with agent
├── index.ts                   # MODIFY: export new components
├── reranker.ts                # CREATE: SiliconFlowReranker
├── sufficiency-checker.ts     # CREATE: SufficiencyChecker  
├── query-expander.ts          # CREATE: QueryExpander
└── agent.ts                   # CREATE: Agent tools + setup

apps/web-client/src/components/
└── Chat.tsx                   # MODIFY: handle [STATUS] messages

.env                           # MODIFY: add SILICONFLOW_RERANK_MODEL
```

---

## Task 1: Environment Config

**Covers:** [S6]

**Files:**
- Modify: `packages/ai-service/src/rag.config.ts`
- Modify: `.env`

- [ ] **Step 1: Update RagConfig interface**

```typescript
// packages/ai-service/src/rag.config.ts
export interface RagConfig {
  dbConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    tableName: string;
    dimensions: number;
  };
  openrouterConfig: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
  };
  siliconflowConfig: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
  };
  rerankModel: string;  // NEW
}
```

- [ ] **Step 2: Add env variable**

```env
# .env - add after SILICONFLOW_BASE_URL
SILICONFLOW_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

- [ ] **Step 3: Update RagModule to pass rerankModel**

```typescript
// apps/api-server/src/rag/rag.module.ts
// Find the RagConfig creation and add:
rerankModel: configService.getOrThrow("SILICONFLOW_RERANK_MODEL"),
```

- [ ] **Step 4: Commit**

```bash
git add packages/ai-service/src/rag.config.ts .env apps/api-server/src/rag/rag.module.ts
git commit -m "chore: add rerank model config"
```

---

## Task 2: SiliconFlowReranker

**Covers:** [S4.1]

**Files:**
- Create: `packages/ai-service/src/reranker.ts`

- [ ] **Step 1: Create reranker.ts**

```typescript
// packages/ai-service/src/reranker.ts
import { Document } from "@langchain/core/documents";

interface RerankConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface RerankResult {
  index: number;
  relevance_score: number;
}

interface RerankResponse {
  results: RerankResult[];
}

export class SiliconFlowReranker {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: RerankConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
  }

  async rerank(
    query: string,
    documents: Document[],
    topN: number = 3,
  ): Promise<Document[]> {
    if (documents.length === 0) return [];
    if (documents.length <= topN) return documents;

    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: documents.map((d) => d.pageContent),
        top_n: topN,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Rerank API failed: ${response.status} - ${error}`);
    }

    const data: RerankResponse = await response.json();

    return data.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((r) => documents[r.index]);
  }
}
```

- [ ] **Step 2: Build to verify no type errors**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/reranker.ts
git commit -m "feat: add SiliconFlowReranker"
```

---

## Task 3: SufficiencyChecker

**Covers:** [S4.2]

**Files:**
- Create: `packages/ai-service/src/sufficiency-checker.ts`

- [ ] **Step 1: Create sufficiency-checker.ts**

```typescript
// packages/ai-service/src/sufficiency-checker.ts
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

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        sufficient: false,
        missingInfo: "无法解析检查结果",
        reason: "LLM 返回格式异常",
      };
    }

    try {
      const result = JSON.parse(jsonMatch[0]);
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
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/sufficiency-checker.ts
git commit -m "feat: add SufficiencyChecker"
```

---

## Task 4: QueryExpander

**Covers:** [S4.3]

**Files:**
- Create: `packages/ai-service/src/query-expander.ts`

- [ ] **Step 1: Create query-expander.ts**

```typescript
// packages/ai-service/src/query-expander.ts
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
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/query-expander.ts
git commit -m "feat: add QueryExpander"
```

---

## Task 5: Agent Tools

**Covers:** [S4.4, S4.5]

**Files:**
- Create: `packages/ai-service/src/agent.ts`

- [ ] **Step 1: Create agent.ts**

```typescript
// packages/ai-service/src/agent.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";
import { SiliconFlowReranker } from "./reranker";
import { SufficiencyChecker } from "./sufficiency-checker";
import { QueryExpander } from "./query-expander";
import { RagConfig } from "./rag.config";

export interface AgentTools {
  retrieveTool: ReturnType<typeof tool>;
  rerankTool: ReturnType<typeof tool>;
  checkTool: ReturnType<typeof tool>;
  expandTool: ReturnType<typeof tool>;
}

export function createAgentTools(
  config: RagConfig,
  vectorStore: PGVectorStore,
  llm: ChatOpenAI,
): AgentTools {
  const reranker = new SiliconFlowReranker({
    apiKey: config.siliconflowConfig.apiKey,
    baseUrl: config.siliconflowConfig.baseUrl,
    model: config.rerankModel,
  });

  const checker = new SufficiencyChecker(llm);
  const expander = new QueryExpander(llm);

  // Hybrid retrieval (reuse existing logic)
  async function hybridRetrieve(
    query: string,
    k: number = 6,
  ): Promise<Document[]> {
    const vectorResults = await vectorStore.similaritySearchWithScore(query, k);
    return vectorResults
      .sort((a, b) => a[1] - b[1]) // sort by distance ascending
      .slice(0, k)
      .map(([doc]) => doc);
  }

  const retrieveTool = tool(
    async ({ query }) => {
      const docs = await hybridRetrieve(query, 6);
      const context = docs
        .map((doc) => {
          const title = doc.metadata?.document_title || "";
          const section = doc.metadata?.section_title || "";
          const prefix = title
            ? `[${title}${section ? " - " + section : ""}]\n`
            : "";
          return prefix + doc.pageContent;
        })
        .join("\n\n");

      return JSON.stringify({
        documentCount: docs.length,
        context,
      });
    },
    {
      name: "retrieve",
      description:
        "从简历向量数据库中检索相关信息。输入应该是搜索查询文本。",
      schema: z.object({
        query: z.string().describe("搜索查询文本"),
      }),
    },
  );

  const rerankTool = tool(
    async ({ query, context }) => {
      // Parse context back to documents
      const docs = context
        .split("\n\n")
        .filter(Boolean)
        .map((text) => new Document({ pageContent: text }));

      const reranked = await reranker.rerank(query, docs, 3);
      const rerankedContext = reranked.map((d) => d.pageContent).join("\n\n");

      return JSON.stringify({
        documentCount: reranked.length,
        context: rerankedContext,
      });
    },
    {
      name: "rerank",
      description:
        "对检索结果进行重排序，返回最相关的 top 3 结果。",
      schema: z.object({
        query: z.string().describe("原始查询"),
        context: z.string().describe("检索到的文档内容"),
      }),
    },
  );

  const checkTool = tool(
    async ({ query, context }) => {
      const result = await checker.check(query, context);
      return JSON.stringify(result);
    },
    {
      name: "check_sufficiency",
      description:
        "检查检索到的信息是否足以回答用户问题。返回 sufficient/missingInfo/reason。",
      schema: z.object({
        query: z.string().describe("用户原始问题"),
        context: z.string().describe("检索到的上下文"),
      }),
    },
  );

  const expandTool = tool(
    async ({ query, missingInfo, foundInfo }) => {
      const expandedQuery = await expander.expand(query, missingInfo, foundInfo);
      return JSON.stringify({ expandedQuery });
    },
    {
      name: "expand_query",
      description:
        "根据缺失信息生成更精准的搜索查询，用于第二轮检索。",
      schema: z.object({
        query: z.string().describe("用户原始问题"),
        missingInfo: z.string().describe("缺失的信息"),
        foundInfo: z.string().describe("已找到的信息"),
      }),
    },
  );

  return { retrieveTool, rerankTool, checkTool, expandTool };
}
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add packages/ai-service/src/agent.ts
git commit -m "feat: add Agent tools (retrieve, rerank, check, expand)"
```

---

## Task 6: RagService Refactor

**Covers:** [S3, S4.5]

**Files:**
- Modify: `packages/ai-service/src/rag.service.ts`
- Modify: `packages/ai-service/src/index.ts`

- [ ] **Step 1: Rewrite rag.service.ts**

Replace the entire file content with:

```typescript
// packages/ai-service/src/rag.service.ts
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { RagConfig } from "./rag.config";
import { createAgentTools } from "./agent";
import { Readable } from "stream";

const AGENT_SYSTEM_PROMPT = `你是一个专业的简历问答助手。你的唯一任务是**极度严格地**根据提供的"上下文"来回答用户的问题。

请严格遵守以下规则：

1. **角色和口吻：** 你的回答必须**全程**以"赵耀"的口吻（第一人称）来陈述简历中的事实和经历。例如："我于2011.09-2015.06在北京信息科技大学就读计算机科学与技术专业，本科学历。"

2. **内容绝对限制：** 答案中的**所有信息**必须能够直接或通过简单归纳从提供的上下文中找到。**绝不允许**添加、推测、编造任何上下文中不存在的内容、技术或经历。

3. **格式严格限制（重要）：** 
   - **严格按照文档中的原始格式回答**，不要自己组织新的结构。
   - 如果文档中只有一行信息，就只回答那一行信息，不要扩展或编造其他内容。
   - **不要将项目名称、工作经历等信息误认为是教育背景**。教育背景只包括：时间、学校、专业、学历层次。
   - 如果上下文中没有明确提到"研究生"、"硕士"、"博士"、"博士后"等学历，就**绝对不要**编造这些信息。

4. **输出格式：** 请使用简洁、专业的语言组织回复。如果上下文中包含 Markdown 格式（如列表、粗体），请保留这些格式以突出重点。

5. **推理和归纳：** 针对"精通哪些技术"或"主要负责什么"这类问题，请直接从上下文中提取技术清单，并用简洁的列表格式展示。

6. **处理无法回答的情况（首要规则）：** 如果提供的上下文信息不足以回答用户的问题（哪怕是缺少一个细节），你必须且只能回复以下这句话，不添加任何额外解释或道歉：
   "我无法从提供的简历信息中找到确切答案。"

你现在有以下工具可用：
- retrieve: 从简历数据库检索信息
- rerank: 对检索结果重排序
- check_sufficiency: 检查信息是否充分
- expand_query: 生成更精准的搜索查询

工作流程：
1. 先用 retrieve 搜索相关信息
2. 用 rerank 精排结果
3. 用 check_sufficiency 检查是否充分
4. 如果不充分，用 expand_query 生成新查询，再 retrieve
5. 信息充分后，用检索到的上下文回答用户问题

注意：最终回答时，直接输出回答内容，不要输出工具调用过程。`;

export class RagService {
  private agent: any;
  private vectorStore: PGVectorStore | undefined;

  constructor(private readonly config: RagConfig) {
    this.initializeAgent();
  }

  private async initializeAgent() {
    try {
      const { dbConfig, openrouterConfig, siliconflowConfig } = this.config;

      // 1. Initialize embeddings
      const embeddings = new OpenAIEmbeddings({
        apiKey: siliconflowConfig.apiKey,
        modelName: siliconflowConfig.embeddingModel,
        configuration: {
          baseURL: siliconflowConfig.baseUrl,
        },
      });

      // 2. Connect to VectorStore
      this.vectorStore = await PGVectorStore.initialize(embeddings, {
        tableName: dbConfig.tableName,
        dimensions: dbConfig.dimensions,
        columns: {
          contentColumnName: "content",
          vectorColumnName: "embedding",
        },
        postgresConnectionOptions: dbConfig,
      });

      // 3. Initialize LLM
      const llm = new ChatOpenAI({
        apiKey: openrouterConfig.apiKey,
        model: openrouterConfig.model,
        temperature: openrouterConfig.temperature,
        maxTokens: 3000,
        streamUsage: false,
        configuration: {
          baseURL: openrouterConfig.baseUrl,
        },
      });

      // 4. Create tools
      const tools = createAgentTools(this.config, this.vectorStore, llm);

      // 5. Create React Agent
      const { createReactAgent } = await import("@langchain/langgraph/prebuilt");
      
      this.agent = createReactAgent({
        llm,
        tools: [
          tools.retrieveTool,
          tools.rerankTool,
          tools.checkTool,
          tools.expandTool,
        ],
        messageModifier: AGENT_SYSTEM_PROMPT,
      });

      console.log("✅ RagService Agent 初始化完成");
    } catch (e: any) {
      console.error("❌ RagService Agent 初始化失败:", e?.message || e);
      throw e;
    }
  }

  /**
   * Stream query with status updates
   */
  async streamQuery(query: string): Promise<Readable> {
    if (!this.agent) {
      await this.initializeAgent();
      if (!this.agent) {
        throw new Error("Agent 未初始化成功");
      }
    }

    const readable = new Readable({ read() {} });

    (async () => {
      try {
        // Emit status
        readable.push(`[STATUS] 正在检索相关信息...\n`);

        const result = await this.agent.invoke({
          messages: [{ role: "user", content: query }],
        });

        // Extract the final response from agent messages
        const messages = result.messages;
        const finalMessage = messages[messages.length - 1];
        
        // Get the actual content (skip tool calls)
        let responseContent = "";
        for (const msg of messages) {
          if (msg._getType() === "ai" && typeof msg.content === "string" && msg.content && !msg.tool_calls?.length) {
            responseContent = msg.content;
          }
        }

        if (responseContent) {
          readable.push(responseContent);
        } else {
          readable.push("我无法从提供的简历信息中找到确切答案。");
        }

        readable.push(null);
      } catch (error) {
        console.error("Agent 执行错误:", error);
        readable.push("抱歉，处理请求时出现错误。");
        readable.push(null);
      }
    })();

    return readable;
  }
}
```

- [ ] **Step 2: Update index.ts exports**

```typescript
// packages/ai-service/src/index.ts
export { RagService } from "./rag.service";
export { RagConfig } from "./rag.config";
export { SiliconFlowReranker } from "./reranker";
export { SufficiencyChecker, SufficiencyResult } from "./sufficiency-checker";
export { QueryExpander } from "./query-expander";
```

- [ ] **Step 3: Build to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add packages/ai-service/src/rag.service.ts packages/ai-service/src/index.ts
git commit -m "refactor: replace RunnableSequence with createReactAgent"
```

---

## Task 7: Frontend Status Handling

**Covers:** [S5]

**Files:**
- Modify: `apps/web-client/src/components/Chat.tsx`

- [ ] **Step 1: Add status state and handle [STATUS] in streaming**

Find the `handleSubmitWithoutTts` function and update the streaming chunk handling:

```typescript
// In Chat.tsx, inside handleSubmitWithoutTts, find the while loop:

while (!done) {
  const { value, done: readerDone } = await reader.read();
  done = readerDone;

  if (value) {
    const chunk = decoder.decode(value, { stream: true });
    accumulatedContent += chunk;

    // Check for status messages
    const lines = accumulatedContent.split("\n");
    let messageContent = "";
    let statusMessage = "";

    for (const line of lines) {
      if (line.startsWith("[STATUS] ")) {
        statusMessage = line.slice(9).trim();
      } else {
        messageContent += line + "\n";
      }
    }

    setMessages((prevMessages) =>
      prevMessages.map((msg) =>
        msg.id === aiMsgId
          ? {
              ...msg,
              content: messageContent.trim() || accumulatedContent,
              status: statusMessage || undefined,
            }
          : msg,
      ),
    );
  }
}
```

- [ ] **Step 2: Update ChatMessage to display status**

Find the message content display section and add status display:

```typescript
// In ChatMessage.tsx, find the content section:

{/* Status indicator */}
{message.status && (
  <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
    <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
    {message.status}
  </div>
)}

{/* 内容 */}
<div className={`font-normal tracking-wide prose prose-sm max-w-none ...`}>
```

- [ ] **Step 3: Update Message type**

```typescript
// In apps/web-client/src/types/index.ts or wherever Message is defined:

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  status?: string;  // NEW
}
```

- [ ] **Step 4: Build frontend to verify**

```bash
pnpm build
```

Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
git add apps/web-client/src/components/Chat.tsx apps/web-client/src/components/ChatMessage.tsx
git commit -m "feat: add status display for Agentic RAG"
```

---

## Task 8: Integration Test

**Covers:** [S8]

**Files:**
- None (manual test)

- [ ] **Step 1: Rebuild packages**

```bash
pnpm build:libs
```

- [ ] **Step 2: Start services**

```bash
pnpm dev
```

- [ ] **Step 3: Test simple query**

Open http://localhost:4001 and ask: "赵耀的学历是什么？"
Expected: Direct answer without iteration

- [ ] **Step 4: Test complex query**

Ask: "赵耀做过哪些项目？用过什么技术？"
Expected: See status messages, then complete answer

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "chore: complete Agentic RAG implementation"
```
