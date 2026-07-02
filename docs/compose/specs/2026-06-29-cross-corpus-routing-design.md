# Phase 3: 多数据源路由（Cross-Corpus Routing）设计

**日期**: 2026-06-29
**分支**: feature/cross-corpus-routing
**状态**: 设计中

---

## [S1] 问题

当前 Agentic RAG（Phase 1 + Phase 2）已实现查询拆分 → 混合检索 → 精排 → 充分性检查 → 迭代补全的完整闭环，但**只检索单一的简历向量库**（`documents` 表）。

随着应用场景扩展，会出现"问题不属于简历范畴"的情况。例如：

- 面试官问："这个系统的 Agentic RAG 是怎么设计的？" → 答案在**项目设计文档**里，不在简历里
- 面试官问："SiliconFlow TTS 的流式播放是怎么实现的？" → 答案在**语音服务文档**里

当前系统会把这类问题也拿去简历库里检索，导致召回不相关文档、甚至触发不必要的迭代补全，最终生成"我无法从提供的简历信息中找到确切答案"这种答非所问的回答。

> **参考**：Google 在 [Gemini Enterprise Agent Platform 的 Agentic RAG](https://research.google/blog/unlocking-dependable-responses-with-gemini-enterprise-agent-platforms-agentic-rag/) 文章中提出了一个关键角色——**Planner Agent**。它的职责是在检索之前"决定去哪个数据源找"。文章实测在 4 个干扰库中选对库的准确率仍达 90.1%，且延迟仅增加 3%。
>
> 当前系统的 StateGraph 架构已经具备了 Orchestrator（图本身）、Query Rewriter、Search Fanout（多子查询检索）、Reranker、Sufficient Context Agent、Iteration、Synthesis 全部角色，**唯一缺的就是 Planner Agent**。Phase 3 就是补上这一块。

---

## [S2] 方案概述

引入 **CorpusPlanner（库路由规划器）** 节点 + **Corpus Registry（多库注册表）**，在 `rewrite` 和 `retrieve` 之间插入一个 LLM 决策环节，让 LLM 根据子查询语义和各库的自我描述，决定每个子查询该去哪个库检索。

### 两个数据源

| 库 ID | 内容 | 表名 | 数据来源 | 向量数 |
|------|------|------|----------|--------|
| `resume` | 赵耀简历（基本信息、工作经历、项目、技能） | `documents`（已有） | 现有 `data/` 下 8 个 txt，不动 | 现有 chunk |
| `docs` | 本项目设计文档（Agentic RAG、Query Rewriter、语音服务） | `documents_docs`（新增） | 复用 `docs/` 下 6 篇现成 Markdown | 新增 chunk |

**数据零成本**：第二个库的内容全部来自仓库内已有的文档，无需额外编写任何内容。

### 核心思想

- **路由而非搜索**：Planner 不做检索，只做"这个子查询属于哪个域"的分类决策
- **每子查询独立路由**：rewrite 拆分出的多个子查询，可以各自路由到不同的库（跨域问题的自然解决）
- **fail-open 兜底**：Planner 任何失败都回退到"全部路由到 resume 库"，等价于现有行为，绝不退化

---

## [S3] 架构

### 核心流程

```
START
  │
  ▼
rewrite ─────────────────────────────────┐  (拆分子查询)
  │                                      │
  ▼                                      │
plan (NEW) ──────────────────────────────┘  (为每个子查询决定去哪个库)
  │  输出: [{query, corpus}, ...]
  ▼
retrieve ◄──────────────────────┐  (按路由去对应库检索 top 6)
  │                             │
  ▼                             │
rerank ─────────────────────────┘  (BGE 精排 top 3)
  │
  ▼
check ──(条件边)──► 充分 OR 迭代达上限(2轮) ──► generate ──► END
  │
  └──(不充分)──► expand ──► (回到 retrieve，沿用首轮路由库)
```

**新增**：`plan` 节点（rewrite 之后、retrieve 之前）
**不变**：`expand → retrieve` 回环沿用首轮 Planner 决定的库（迭代补检只补关键词，不重新做库分类）

### 与现有代码的关系

| 现有组件 | Phase 3 改动 |
|----------|-------------|
| `RagState`（5 个字段） | 新增 `plan: RoutePlan` 字段 |
| `retrieveNode`（调单库 `hybridRetrieve`） | 改为按 `plan` 路由去对应库检索 |
| `RagDeps.hybridRetrieve: (query, k) → Doc[]` | 升级为 `retrieveByCorpus: (corpus, query, k) → Doc[]` |
| `createRagDeps`（收单个 `vectorStore`） | 改为收 `Map<string, PGVectorStore>` |
| `RagService.initialize`（初始化单 vectorStore） | 改为循环初始化多个 vectorStore |
| `RagConfig.dbConfig`（单表） | 扩展为 `corpora: CorpusConfig[]` |
| `ingest.ts`（写单表） | 支持按 corpus 字段写入对应表 |

---

## [S4] 组件设计

### 4.1 Corpus Registry（多库注册表）

注册多个向量库，每个库带一段"自我描述"供 Planner 决策。

```typescript
interface CorpusConfig {
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

interface CorpusRegistry {
  /** 库配置（含 description） */
  configs: CorpusConfig[];
  /** 已初始化的向量库实例，按 id 索引 */
  stores: Map<string, PGVectorStore>;
}
```

**注册表内容（初始两个库）**：

```typescript
const corpora: CorpusConfig[] = [
  {
    id: "resume",
    tableName: "documents",
    dimensions: 1024,
    description:
      "赵耀的个人简历，包含基本信息、教育背景、工作经历、项目经历（科技部大屏、Wormhole、SDP 等）、专业技能。适合回答关于赵耀是谁、做过什么、会什么的问题。",
  },
  {
    id: "docs",
    tableName: "documents_docs",
    dimensions: 1024,
    description:
      "本 RAG 简历问答系统的设计文档，包含 Agentic RAG 架构（StateGraph 流程、查询拆分、混合检索、BGE 精排、充分性检查、迭代补全）、Query Rewriter 设计、语音服务（ASR/TTS、流式播放）的技术实现细节。适合回答这个系统本身是怎么设计的问题。",
  },
];
```

### 4.2 CorpusPlanner（库路由规划器）

仿照 `QueryRewriter` 的代码模式（纯逻辑 + fail-open + brace-counting JSON 解析）。

```typescript
import { ChatOpenAI } from "@langchain/openai";

export interface RouteItem {
  query: string;
  corpus: string;
}

export type RoutePlan = RouteItem[];

export class CorpusPlanner {
  constructor(private readonly llm: ChatOpenAI) {}

  /**
   * 为每个子查询决定目标库。
   *
   * @param subQueries rewrite 产出的子查询列表
   * @param corpora 可用库的配置（用其 description 做分类）
   * @returns 路由计划，每项 {query, corpus}；失败时 fail-open 全部路由到 fallbackCorpus
   */
  async plan(
    subQueries: string[],
    corpora: CorpusConfig[],
    fallbackCorpus: string,
  ): Promise<RoutePlan> {
    // ... 仿 query-rewriter.ts: invoke → brace-counting 提取 JSON → 校验 → fail-open
  }
}
```

**fail-open 策略（三层防御）**：

1. `llm.invoke` 抛异常（API 挂了/超时）→ `catch` 返回 `subQueries.map(q => ({query: q, corpus: fallbackCorpus}))`
2. JSON 解析失败（LLM 输出乱码/被 markdown 围栏污染）→ brace-counting 提取失败 → 返回 fallback
3. 解析成功但 `corpus` 不是已注册的 id → 校验失败，该项降级为 fallback

**fail-open 的本质**：Planner 是"增强能力"，它的失败绝对不能让现有功能变差。API 挂了？大不了退化到 Phase 2 行为（全从简历库找），用户照样能问简历问题。

### 4.3 retrieveNode 改造

当前实现（`rag-graph.ts:99-131`）：

```typescript
// 现状：所有子查询都打同一个 vectorStore
const queries = state.subQueries.length > 0 ? state.subQueries : [state.query];
for (const q of queries) {
  const docs = await deps.hybridRetrieve(q, 6);  // 单库
  newDocs.push(...docs);
}
```

Phase 3 后：

```typescript
// 改造后：按 plan 路由去对应库
const routes = state.plan ?? subQueries.map(q => ({ query: q, corpus: "resume" }));
for (const route of routes) {
  const docs = await deps.retrieveByCorpus(route.corpus, route.query, 6);  // 多库
  newDocs.push(...docs);
}
```

**去重 key 增强**：当前去重用 `pageContent.trim()`，多库场景下不同库可能有相同标题的文档，去重 key 加上 `corpus` 维度避免误吞：

```typescript
const key = `${doc.metadata?.corpus}::${doc.pageContent.trim()}`;
```

---

## [S5] System Prompt 设计

```
你是一个数据源路由规划器。给定多个子查询和多个数据源（语料库）的描述，为每个子查询选择最合适的数据源。

可用数据源：
{corpora_descriptions}

子查询列表：
{sub_queries}

规则：
1. 根据子查询的语义，选择最可能包含答案的数据源
2. 每个子查询独立判断，可以选不同的数据源
3. 只能从给定的数据源 id 中选择，不要编造

请返回 JSON 格式（不要输出其他内容）：
{"routes": [{"query": "子查询原文", "corpus": "数据源id"}, ...]}
```

**Prompt 设计要点**：
- 把每个库的 `description` 拼进去，让 LLM 做基于语义的分类
- 要求 `query` 字段回填原子查询原文，保证检索时 query 不变形
- 强制 `corpus` 只能从已注册 id 选，配合代码层校验防幻觉

---

## [S6] 文件改动清单

### 新增文件

```
packages/ai-service/src/
├── corpus-planner.ts      # CorpusPlanner 类（仿 query-rewriter.ts）
└── corpus-registry.ts     # CorpusConfig 类型 + CorpusRegistry 类型 + 默认两库配置
```

### 修改文件

```
packages/ai-service/src/
├── rag.config.ts          # dbConfig 单表 → corpora: CorpusConfig[] 数组
├── rag.service.ts         # 初始化单 vectorStore → 循环初始化 Map<string, PGVectorStore>
├── agent.ts               # RagDeps 加 planner 依赖，hybridRetrieve → retrieveByCorpus(corpus, query, k)
├── rag-graph.ts           # RagState 加 plan 字段，新增 planNode，retrieveNode 改多库分发
├── index.ts               # 导出 CorpusPlanner、RoutePlan、CorpusConfig
packages/ai-service/scripts/
├── ingest.ts              # 支持按 corpus 字段写入对应表（多表循环入库）
packages/ai-service/data/
└── ingestion_config.json  # 每个 doc 加 corpus 字段，新增 docs 库的文档条目
```

### 数据源（docs 库复用现有文件，零编写）

```
docs/features/agentic-rag.md                    # Agentic RAG 特性总结
docs/features/speech-service.md                 # 语音服务特性总结
docs/compose/specs/2026-06-13-agentic-rag-design.md   # Agentic RAG 设计 spec
docs/compose/specs/2026-06-14-query-rewriter-design.md # Query Rewriter 设计 spec
docs/compose/plans/2026-06-14-agentic-rag-plan.md     # Agentic RAG 实施 plan
docs/compose/plans/2026-06-14-query-rewriter-plan.md  # Query Rewriter 实施 plan
```

---

## [S7] 性能预期

| 指标 | Phase 2（现状） | Phase 3（预期） | 说明 |
|------|----------------|----------------|------|
| 检索准确率 | 简历问题高，跨域问题低 | 全场景提升 | 跨域问题不再用简历库硬找 |
| 首轮延迟 | rewrite + retrieve + rerank | + Planner 1 次 LLM 调用（约 +1-2s） | Planner 用 temperature=0，响应快 |
| 资源占用 | 1 个 PGVectorStore | 2 个 PGVectorStore（共享连接池） | 同一 PG 实例，几乎零额外开销 |
| 失败影响 | — | Planner 挂掉自动 fail-open 回 resume 库 | 绝不退化 |
| 迭代轮数 | 最多 2 轮 | 最多 2 轮（不变） | expand 不触发 Planner，沿用首轮库 |

---

## [S8] 测试验证

| 场景 | 输入示例 | 预期路由 | 预期结果 |
|------|----------|----------|----------|
| 简历问题 | "赵耀的学历是什么？" | 全部 → resume | 正常回答 |
| 简历问题（复杂） | "赵耀做过哪些项目？用过什么技术？" | 拆分后全部 → resume | 正常拆分检索 |
| **跨域问题** | "这个系统的 Agentic RAG 流程是怎样的？" | 全部 → docs | 从设计文档召回并回答 |
| **跨域问题** | "SiliconFlow TTS 流式播放怎么实现的？" | 全部 → docs | 从语音文档召回 |
| **混合问题** | "赵耀是谁？他做的这个 RAG 系统怎么设计的？" | 子查询1→resume，子查询2→docs | 两库分别召回合并 |
| Planner 失败 | （模拟 API 超时） | fail-open → 全部 resume | 退化到 Phase 2 行为，不报错 |
| 向后兼容 | 单库配置（只注册 resume） | 跳过 Planner | 等价 Phase 2 |
