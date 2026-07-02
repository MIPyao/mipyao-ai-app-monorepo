# Phase 3: 多数据源路由（Cross-Corpus Routing）实施 Plan

> **For agentic workers:** This plan implements `docs/compose/specs/2026-06-29-cross-corpus-routing-design.md`. Execute task by task with `compose:subagent` / `compose:execute`, tracking progress with `- [ ]` checkboxes. Validate build after each task.

**Date:** 2026-06-29
**Spec:** `docs/compose/specs/2026-06-29-cross-corpus-routing-design.md`

**Goal:** Add a Corpus Planner node to the StateGraph that routes each rewritten sub-query to the appropriate vector store (`resume` vs `docs`), enabling cross-corpus retrieval without degrading single-corpus behavior.

**Architecture:** Insert `plan` node between `rewrite` and `retrieve`. Maintain a `Map<string, PGVectorStore>` (Corpus Registry) holding multiple stores on the same PostgreSQL instance. Planner uses fail-open: any failure falls back to routing all sub-queries to the `resume` corpus, preserving Phase 2 behavior.

**Tech Stack:** LangGraph StateGraph, LangChain PGVectorStore, OpenRouter LLM, TypeScript strict.

---

## File Structure

```
packages/ai-service/src/
├── corpus-registry.ts      # CREATE  CorpusConfig 类型 + 默认两库配置
├── corpus-planner.ts       # CREATE  CorpusPlanner 类（仿 query-rewriter.ts）
├── rag.config.ts           # MODIFY  dbConfig 单表 → corpora: CorpusConfig[]
├── rag.service.ts          # MODIFY  单 vectorStore → Map<string, PGVectorStore>
├── agent.ts                # MODIFY  RagDeps 加 planner，hybridRetrieve → retrieveByCorpus
├── rag-graph.ts            # MODIFY  RagState 加 plan 字段，新增 planNode，retrieveNode 改多库分发
└── index.ts                # MODIFY  导出新组件

packages/ai-service/scripts/
└── ingest.ts               # MODIFY  支持按 corpus 字段写入对应表

packages/ai-service/data/
└── ingestion_config.json   # MODIFY  加 corpus 字段 + docs 库文档条目
```

---

## Task 1: Corpus Registry + 配置扩展

**Covers:** [S4.1]
**Files:** Create `packages/ai-service/src/corpus-registry.ts`; Modify `packages/ai-service/src/rag.config.ts`, `packages/ai-service/src/index.ts`

- [ ] **Step 1: 创建 corpus-registry.ts**

  创建 `packages/ai-service/src/corpus-registry.ts`，定义 `CorpusConfig` 类型、`CorpusRegistry` 类型、默认两库配置数组 `DEFAULT_CORPORA`：

  ```typescript
  import type { PGVectorStore } from "@langchain/community/vectorstores/pgvector";

  export interface CorpusConfig {
    /** 库唯一标识，如 "resume" | "docs" */
    id: string;
    /** PostgreSQL 表名，如 "documents" | "documents_docs" */
    tableName: string;
    /** 向量维度（所有库统一用 bge-m3，都是 1024） */
    dimensions: number;
    /**
     * 库的自我描述，喂给 Planner LLM 做分类决策。
     * 必须清晰描述"这个库装了什么、适合回答什么类型的问题"。
     */
    description: string;
  }

  /** 已初始化的多库注册表 */
  export interface CorpusRegistry {
    configs: CorpusConfig[];
    stores: Map<string, PGVectorStore>;
  }

  /** 默认两库配置 */
  export const DEFAULT_CORPORA: CorpusConfig[] = [
    {
      id: "resume",
      tableName: process.env.POSTGRES_TABLE_NAME || "documents",
      dimensions: Number(process.env.POSTGRES_DIMENSIONS) || 1024,
      description:
        "赵耀的个人简历，包含基本信息、教育背景、工作经历、项目经历（科技部大屏、Wormhole、SDP 等）、专业技能。适合回答关于赵耀是谁、做过什么、会什么的问题。",
    },
    {
      id: "docs",
      tableName: process.env.POSTGRES_TABLE_NAME_DOCS || "documents_docs",
      dimensions: Number(process.env.POSTGRES_DIMENSIONS) || 1024,
      description:
        "本 RAG 简历问答系统的设计文档，包含 Agentic RAG 架构（StateGraph 流程、查询拆分、混合检索、BGE 精排、充分性检查、迭代补全）、Query Rewriter 设计、语音服务（ASR/TTS、流式播放）的技术实现细节。适合回答这个系统本身是怎么设计的问题。",
    },
  ];
  ```

- [ ] **Step 2: 扩展 rag.config.ts**

  在 `RagConfig` 接口中保留 `dbConfig`（兼容 ingest.ts），新增 `corpora` 字段：

  ```typescript
  import type { CorpusConfig } from "./corpus-registry";

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
      rerankModel: string;
    };
    /** Phase 3: 多库配置 */
    corpora: CorpusConfig[];
  }
  ```

- [ ] **Step 3: 更新 index.ts 导出**

  ```typescript
  export { CorpusConfig, CorpusRegistry, DEFAULT_CORPORA } from "./corpus-registry";
  export { CorpusPlanner, RoutePlan, RouteItem } from "./corpus-planner";
  ```

- [ ] **Step 4: 验证构建**

  ```bash
  pnpm build:libs
  ```
  Expected: BUILD SUCCESS（corpus-planner.ts 此时还未创建，可在 Task 3 后一起导出；或先注释掉该导出行）

  ```bash
  git add packages/ai-service/src/corpus-registry.ts packages/ai-service/src/rag.config.ts packages/ai-service/src/index.ts
  git commit -m "feat: add CorpusRegistry and extend RagConfig for multi-corpus support"
  ```

---

## Task 2: 文档库数据准备

**Covers:** [S2], [S6]
**Files:** Modify `packages/ai-service/data/ingestion_config.json`, `packages/ai-service/scripts/ingest.ts`; 复用 `docs/` 下 6 篇 Markdown

- [ ] **Step 1: 扩展 ingestion_config.json 加 corpus 字段**

  为现有 8 个简历条目加 `corpus: "resume"`，并新增 docs 库的 6 个文档条目。注意 docs 文档路径用相对 monorepo root 的路径：

  ```jsonc
  [
    // === resume 库（现有 8 个，加 corpus 字段）===
    {
      "file": "resume1.txt",
      "corpus": "resume",
      "document_title": "基本信息",
      "section_title": "姓名 求职意向 籍贯 出生年月 毕业院校 邮箱 github 教育背景"
    },
    // ... resume2-8 同样加 "corpus": "resume"

    // === docs 库（新增 6 个，复用 docs/ 下 Markdown）===
    {
      "file": "../../../docs/features/agentic-rag.md",
      "corpus": "docs",
      "document_title": "Agentic RAG 特性总结",
      "section_title": "StateGraph 流程 查询拆分 混合检索 精排 充分性检查 迭代补全"
    },
    {
      "file": "../../../docs/features/speech-service.md",
      "corpus": "docs",
      "document_title": "语音服务特性总结",
      "section_title": "ASR TTS 流式播放 WAV 编码"
    },
    {
      "file": "../../../docs/compose/specs/2026-06-13-agentic-rag-design.md",
      "corpus": "docs",
      "document_title": "Agentic RAG 设计 spec",
      "section_title": "设计 问题 方案 架构 组件设计"
    },
    {
      "file": "../../../docs/compose/specs/2026-06-14-query-rewriter-design.md",
      "corpus": "docs",
      "document_title": "Query Rewriter 设计 spec",
      "section_title": "查询拆分 子查询 设计"
    },
    {
      "file": "../../../docs/compose/plans/2026-06-14-agentic-rag-plan.md",
      "corpus": "docs",
      "document_title": "Agentic RAG 实施 plan",
      "section_title": "实施步骤 任务"
    },
    {
      "file": "../../../docs/compose/plans/2026-06-14-query-rewriter-plan.md",
      "corpus": "docs",
      "document_title": "Query Rewriter 实施 plan",
      "section_title": "实施步骤 任务"
    }
  ]
  ```

- [ ] **Step 2: 改造 ingest.ts 支持多表写入**

  核心改动：`loadAndEnhanceDocuments` 返回值带上 corpus 元数据；`ingestData` 按 corpus 分组，为每个 corpus 初始化独立的 `PGVectorStore`（tableName 不同），分别写入对应表。

  关键代码（伪代码，需对接现有错误处理与日志风格）：

  ```typescript
  // 1. 加载时把 corpus 写入 metadata
  const metadata = {
    source: docConfig.file,
    corpus: docConfig.corpus,  // NEW
    document_title: docConfig.document_title,
    section_title: docConfig.section_title,
  };

  // 2. 按 corpus 分组
  const docsByCorpus = new Map<string, Document[]>();
  for (const doc of allDocs) {
    const corpus = doc.metadata.corpus;
    if (!docsByCorpus.has(corpus)) docsByCorpus.set(corpus, []);
    docsByCorpus.get(corpus)!.push(doc);
  }

  // 3. 每个 corpus 一个 PGVectorStore，按 tableName 分表
  for (const [corpus, docs] of docsByCorpus) {
    const corpusConfig = config.corpora.find(c => c.id === corpus);
    const vectorStore = await PGVectorStore.initialize(embeddings, {
      tableName: corpusConfig.tableName,
      dimensions: corpusConfig.dimensions,
      // ... 其余配置同现有
    });
    const chunks = await splitter.splitDocuments(docs);
    // 批量入库（沿用现有 batchSize=10 逻辑）
    for (let i = 0; i < chunks.length; i += batchSize) {
      await vectorStore.addDocuments(chunks.slice(i, i + batchSize));
    }
  }
  ```

  `clearTable` 和 `dropTableIfDimensionMismatch` 需要遍历 `config.corpora` 中每个 tableName 执行。

- [ ] **Step 3: 添加 .env.example 新增项**

  ```
  # --- Phase 3: docs 库表名 ---
  POSTGRES_TABLE_NAME_DOCS=documents_docs
  ```

- [ ] **Step 4: 导入数据并验证**

  ```bash
  cd packages/ai-service
  pnpm ingest:data
  ```
  Expected: 日志显示 resume 库和 docs 库分别入库成功，两张表都有数据。

  ```bash
  # 验证两张表
  docker exec ai_pg_db psql -U rag_user -d ai_rag_db -c "SELECT COUNT(*) FROM documents;"
  docker exec ai_pg_db psql -U rag_user -d ai_rag_db -c "SELECT COUNT(*) FROM documents_docs;"
  ```
  Expected: `documents` 行数与之前一致；`documents_docs` 行数 > 0。

  ```bash
  git add packages/ai-service/data/ingestion_config.json packages/ai-service/scripts/ingest.ts .env.example
  git commit -m "feat: support multi-corpus ingestion for resume and docs tables"
  ```

---

## Task 3: CorpusPlanner 组件

**Covers:** [S4.2], [S5]
**Files:** Create `packages/ai-service/src/corpus-planner.ts`

- [ ] **Step 1: 创建 corpus-planner.ts**

  仿 `query-rewriter.ts` 的结构（构造只持有 `ChatOpenAI`、prompt 用模块常量 + `{placeholder}` + `.replace()`、三层 fail-open 防御、brace-counting JSON 提取）。

  ```typescript
  import { ChatOpenAI } from "@langchain/openai";
  import type { CorpusConfig } from "./corpus-registry";

  export interface RouteItem {
    query: string;
    corpus: string;
  }

  export type RoutePlan = RouteItem[];

  const PLAN_PROMPT = `你是一个数据源路由规划器。给定多个子查询和多个数据源（语料库）的描述，为每个子查询选择最合适的数据源。

可用数据源：
{corpora_descriptions}

子查询列表：
{sub_queries}

规则：
1. 根据子查询的语义，选择最可能包含答案的数据源
2. 每个子查询独立判断，可以选不同的数据源
3. 只能从给定的数据源 id 中选择，不要编造

请返回 JSON 格式（不要输出其他内容）：
{"routes": [{"query": "子查询原文", "corpus": "数据源id"}, ...]}`;

  export class CorpusPlanner {
    constructor(private readonly llm: ChatOpenAI) {}

    /**
     * 为每个子查询决定目标库。
     * fail-open：任何失败都回退到全部路由到 fallbackCorpus。
     */
    async plan(
      subQueries: string[],
      corpora: CorpusConfig[],
      fallbackCorpus: string,
    ): Promise<RoutePlan> {
      try {
        const validCorpusIds = new Set(corpora.map((c) => c.id));

        // 拼接各库 description
        const corporaDescriptions = corpora
          .map((c) => `- ${c.id}: ${c.description}`)
          .join("\n");

        const prompt = PLAN_PROMPT.replace("{corpora_descriptions}", corporaDescriptions)
          .replace("{sub_queries}", subQueries.map((q) => `- ${q}`).join("\n"));

        const response = await this.llm.invoke(prompt);
        const content =
          typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        // brace-counting 提取第一个完整 JSON 对象（仿 query-rewriter.ts）
        const jsonStr = extractFirstJsonObject(content);
        if (!jsonStr) {
          return failOpen(subQueries, fallbackCorpus);
        }

        try {
          const result = JSON.parse(jsonStr);
          if (!Array.isArray(result.routes)) {
            return failOpen(subQueries, fallbackCorpus);
          }
          // 校验：每项 query 必须有、corpus 必须在已注册 id 内，否则该项降级
          return result.routes.map((r: any) => ({
            query: typeof r.query === "string" ? r.query : "",
            corpus: validCorpusIds.has(r.corpus) ? r.corpus : fallbackCorpus,
          }));
        } catch {
          return failOpen(subQueries, fallbackCorpus);
        }
      } catch (error) {
        console.error("CorpusPlanner error:", error);
        return failOpen(subQueries, fallbackCorpus);
      }
    }
  }

  /** fail-open：全部子查询路由到 fallback 库，等价于 Phase 2 行为 */
  function failOpen(subQueries: string[], fallbackCorpus: string): RoutePlan {
    return subQueries.map((q) => ({ query: q, corpus: fallbackCorpus }));
  }

  /** brace-counting 提取第一个完整 JSON 对象 */
  function extractFirstJsonObject(content: string): string | null {
    const startIdx = content.indexOf("{");
    if (startIdx === -1) return null;
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
    return content.substring(startIdx, endIdx + 1);
  }
  ```

- [ ] **Step 2: 验证构建**

  ```bash
  pnpm build:libs
  ```
  Expected: BUILD SUCCESS

  ```bash
  git add packages/ai-service/src/corpus-planner.ts
  git commit -m "feat: add CorpusPlanner with fail-open routing logic"
  ```

---

## Task 4: StateGraph 插入 plan 节点

**Covers:** [S3], [S4.3]
**Files:** Modify `packages/ai-service/src/agent.ts`, `packages/ai-service/src/rag-graph.ts`, `packages/ai-service/src/rag.service.ts`

- [ ] **Step 1: 改造 agent.ts（RagDeps + createRagDeps）**

  `RagDeps` 接口：新增 `planner` 依赖，把 `hybridRetrieve` 升级为带 corpus 维度的 `retrieveByCorpus`。

  ```typescript
  export interface RagDeps {
    rewriter: QueryRewriter;
    planner: CorpusPlanner;  // NEW
    /** Phase 3: 按 corpus 路由到对应库检索 */
    retrieveByCorpus: (corpus: string, query: string, k?: number) => Promise<Document[]>;
    /** 可用库配置（供 plan 节点拿 description） */
    corpora: CorpusConfig[];
    /** Planner fail-open 时的兜底库 */
    fallbackCorpus: string;
    reranker: SiliconFlowReranker;
    checker: SufficiencyChecker;
    expander: QueryExpander;
    llm: ChatOpenAI;
  }
  ```

  `createRagDeps` 签名：把单个 `vectorStore` 改为 `registry: CorpusRegistry`，内部闭包按 corpus 取对应 store。

  ```typescript
  export function createRagDeps(
    config: RagConfig,
    registry: CorpusRegistry,
    llm: ChatOpenAI,
  ): RagDeps {
    const reranker = new SiliconFlowReranker({...});
    const checker = new SufficiencyChecker(llm);
    const expander = new QueryExpander(llm);
    const rewriter = new QueryRewriter(llm);
    const planner = new CorpusPlanner(llm);  // NEW

    return {
      rewriter,
      planner,
      retrieveByCorpus: (corpus, query, k?) => {
        const store = registry.stores.get(corpus);
        if (!store) {
          // fail-open：corpus 不存在则用 fallback 库
          const fallback = registry.stores.get(config.corpora[0].id);
          return hybridRetrieve(fallback!, query, k ?? 6);
        }
        return hybridRetrieve(store, query, k ?? 6);
      },
      corpora: registry.configs,
      fallbackCorpus: config.corpora[0].id,
      reranker,
      checker,
      expander,
      llm,
    };
  }
  ```

  注意：现有 `hybridRetrieve` 函数签名不变（仍接收 `vectorStore, query, k`），`retrieveByCorpus` 只是在它外面包一层按 corpus 选 store。

- [ ] **Step 2: 改造 rag-graph.ts（RagState + planNode + retrieveNode）**

  RagState 加 `plan` 字段（沿用覆盖 reducer）：

  ```typescript
  const RagState = Annotation.Root({
    query: Annotation<string>,
    subQueries: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
    // NEW: Planner 路由计划
    plan: Annotation<RoutePlan | null>({ reducer: (_, next) => next, default: () => null }),
    documents: Annotation<Document[]>({ reducer: (_, next) => next, default: () => [] }),
    sufficiency: Annotation<SufficiencyResult | null>({ reducer: (_, next) => next, default: () => null }),
    iteration: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  });
  ```

  新增 `planNode`（位于 rewrite 和 retrieve 之间）：

  ```typescript
  async function planNode(state, deps, stream): Promise<Partial<RagStateType>> {
    // 单库时跳过 Planner（向后兼容）
    if (deps.corpora.length <= 1) {
      return { plan: null };
    }
    pushStatus(stream, "正在规划数据源...");
    const queries = state.subQueries.length > 0 ? state.subQueries : [state.query];
    const routePlan = await deps.planner.plan(queries, deps.corpora, deps.fallbackCorpus);
    console.log(`   🧭 [plan] 路由结果:`);
    routePlan.forEach((r) => console.log(`      → "${r.query}" → ${r.corpus}`));
    return { plan: routePlan };
  }
  ```

  `retrieveNode` 改为按 plan 路由去对应库：

  ```typescript
  async function retrieveNode(state, deps, stream): Promise<Partial<RagStateType>> {
    pushStatus(stream, STATUS.retrieve);
    // 有 plan 用 plan，无 plan（单库兼容或 expand 回环）退回 subQueries
    const routes: RouteItem[] =
      state.plan && state.plan.length > 0
        ? state.plan
        : (state.subQueries.length > 0 ? state.subQueries : [state.query])
            .map((q) => ({ query: q, corpus: deps.fallbackCorpus }));

    const newDocs: Document[] = [];
    for (const route of routes) {
      console.log(`   🔍 [retrieve] (${route.corpus}) 搜索: "${route.query}"`);
      const docs = await deps.retrieveByCorpus(route.corpus, route.query, 6);
      // 给召回文档打上 corpus 标记（去重 key 用）
      docs.forEach((d) => {
        if (!d.metadata.corpus) d.metadata.corpus = route.corpus;
      });
      newDocs.push(...docs);
    }
    // 去重 key 加 corpus 维度
    const seen = new Set<string>();
    const merged: Document[] = [];
    for (const doc of [...state.documents, ...newDocs]) {
      const key = `${doc.metadata?.corpus}::${doc.pageContent.trim()}`;
      if (!seen.has(key)) { seen.add(key); merged.push(doc); }
    }
    const iteration = state.iteration === 0 ? 1 : state.iteration;
    return { documents: merged, iteration };
  }
  ```

  `createRagGraph` 加 plan 节点和连边：

  ```typescript
  const graph = new StateGraph(RagState)
    .addNode("rewrite", ...)
    .addNode("plan", async (state) => planNode(state, deps, stream))  // NEW
    .addNode("retrieve", ...)
    // ... 其余节点不变

  graph.addEdge(START, "rewrite");
  graph.addEdge("rewrite", "plan");     // NEW: rewrite → plan（原来是 rewrite → retrieve）
  graph.addEdge("plan", "retrieve");    // NEW
  graph.addEdge("retrieve", "rerank");
  graph.addEdge("rerank", "check");
  graph.addEdge("expand", "retrieve");  // 回环不变（沿用首轮 plan 的库）
  graph.addEdge("generate", END);
  graph.addConditionalEdges("check", routeAfterCheck, { generate: "generate", expand: "expand" });
  ```

  STATUS 常量加一条：

  ```typescript
  const STATUS = {
    rewrite: "正在拆分问题...",
    plan: "正在规划数据源...",   // NEW
    retrieve: "正在检索相关信息...",
    rerank: "正在精排文档...",
    check: "正在检查信息充分性...",
    expand: "正在扩展查询...",
  } as const;
  ```

- [ ] **Step 3: 改造 rag.service.ts（初始化多 vectorStore）**

  `RagService.initialize()` 把单个 vectorStore 初始化改为遍历 `config.corpora` 循环初始化，构建 `CorpusRegistry`。

  ```typescript
  private async initialize(): Promise<void> {
    try {
      const { openrouterConfig, siliconflowConfig, corpora } = this.config;

      const embeddings = new OpenAIEmbeddings({...});

      // Phase 3: 循环初始化每个 corpus 的 vectorStore
      const stores = new Map<string, PGVectorStore>();
      for (const corpus of corpora) {
        const store = await PGVectorStore.initialize(embeddings, {
          tableName: corpus.tableName,
          dimensions: corpus.dimensions,
          columns: { contentColumnName: "content", vectorColumnName: "embedding" },
          postgresConnectionOptions: this.config.dbConfig,
        });
        stores.set(corpus.id, store);
      }
      const registry: CorpusRegistry = { configs: corpora, stores };

      const llm = new ChatOpenAI({...});

      this.deps = createRagDeps(this.config, registry, llm);
      console.log(`✅ RagService StateGraph 依赖初始化完成（${corpora.length} 个语料库: ${corpora.map(c => c.id).join(", ")}）`);
    } catch (e: any) {
      console.error("❌ RagService 初始化失败:", e?.message || e);
      throw e;
    }
  }
  ```

  `this.vectorStore` 字段可以移除（已被 registry 取代），或保留为兼容字段指向 resume store。

- [ ] **Step 4: 验证构建**

  ```bash
  pnpm build:libs
  ```
  Expected: BUILD SUCCESS

  ```bash
  git add packages/ai-service/src/agent.ts packages/ai-service/src/rag-graph.ts packages/ai-service/src/rag.service.ts
  git commit -m "feat: integrate CorpusPlanner node into StateGraph for cross-corpus routing"
  ```

---

## Task 5: 向后兼容验证 + 端到端测试

**Covers:** [S7], [S8]
**Files:** 无（测试验证）

- [ ] **Step 1: 验证向后兼容（单库场景）**

  临时把 `DEFAULT_CORPORA` 改成只含 resume 一个库，启动后端，查询 "赵耀的学历是什么？"。

  Expected: 日志显示 `[plan] corpora.length <= 1，跳过 Planner`；行为与 Phase 2 完全一致；正常回答。

  验证后恢复双库配置。

- [ ] **Step 2: 端到端测试 - 简历问题**

  ```bash
  curl "http://localhost:4321/rag/stream?query=赵耀的学历是什么"
  ```
  Expected: `[STATUS] 正在拆分问题...` → `[STATUS] 正在规划数据源...` → 路由日志显示 `→ resume` → 正常检索回答。

- [ ] **Step 3: 端到端测试 - 跨域问题**

  ```bash
  curl "http://localhost:4321/rag/stream?query=这个系统的Agentic%20RAG流程是怎样的"
  ```
  Expected: 路由日志显示 `→ docs`；从设计文档召回；回答涉及 StateGraph / rewrite / retrieve / rerank / check 等流程。

- [ ] **Step 4: 端到端测试 - 混合问题**

  ```bash
  curl "http://localhost:4321/rag/stream?query=赵耀是谁他做的这个RAG系统怎么设计的"
  ```
  Expected: rewrite 拆分为多个子查询；Planner 把"赵耀是谁"→ resume、"RAG 系统怎么设计"→ docs；两库分别召回合并。

- [ ] **Step 5: 端到端测试 - Planner fail-open**

  临时在 `CorpusPlanner.plan` 开头插入 `throw new Error("模拟失败")`，查询任意问题。

  Expected: 日志显示 `CorpusPlanner error`；自动 fail-open 全部路由到 resume；流程不中断；正常回答（简历类问题）或诚实回答缺失（跨域问题，从 resume 库找不到设计文档内容）。

  验证后移除测试代码。

- [ ] **Step 6: lint 验证**

  ```bash
  pnpm lint
  ```
  Expected: 0 error

  ```bash
  git add docs/features/cross-corpus-routing.md  # 如有更新特性文档
  git commit -m "test: verify cross-corpus routing end-to-end and backward compatibility"
  ```

---

## 完成标准

- [ ] `pnpm build:libs` BUILD SUCCESS
- [ ] `pnpm lint` 0 error
- [ ] 单库配置向后兼容（行为等价 Phase 2）
- [ ] 双库配置：简历问题 → resume，跨域问题 → docs，混合问题 → 拆分路由
- [ ] Planner fail-open：任何失败都不中断流程，退化到 Phase 2 行为
- [ ] `docs/features/agentic-rag.md` 更新 Phase 3 完成状态（可选）
