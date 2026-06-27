# Agentic RAG 特性总结

**分支**: `feature/agentic-rag`
**状态**: Phase 1 + Phase 2 + StateGraph 迁移完成
**日期**: 2026-06-28

---

## 概述

将 RAG 从单次检索升级为 Agentic RAG，实现"查询拆分 → 混合检索 → 精排 → 中间草稿充分性检查 → 迭代补全 → 生成"的完整闭环。基于 LangGraph StateGraph 显式状态图 + 条件边保证流程顺序，不再依赖 LLM 自觉按序调用工具。

## 架构

### 之前

```
用户问题 → hybridRetrieve(top3) → Prompt → LLM → 流式输出
           (单次检索，无迭代)        (静态模板)    (单次调用)
```

### 现在

```
START
  │
  ▼
rewrite ────────────────────────────┐
  │                                 │
  ▼                                 │
retrieve ◄──────────────────┐       │ (对每个子查询分别混合检索)
  │                         │       │
  ▼                         │       │
rerank ──────────────────────────────┘ (BGE 精排 top 3)
  │
  ▼
check ──(条件边)──► 充分 OR 达到迭代上限 ──► generate ──► END
  │
  └──(不充分且未到上限)──► expand ─────────► (回到 retrieve)
```

**流程由图拓扑硬保证**：`addConditionalEdges("check", routeAfterCheck)` 根据 check 结果和迭代计数器路由，不依赖 prompt 约束 LLM 行为。

## 核心组件

### 状态图（StateGraph）

| 文件 | 职责 |
|------|------|
| `rag-graph.ts` | 图定义：`Annotation.Root` 状态（query/subQueries/documents/sufficiency/iteration）、6 个节点、条件边、`createRagGraph()` 工厂 |
| `agent.ts` | 纯逻辑依赖：`createRagDeps()` 返回 `RagDeps`（rewriter/hybridRetrieve/reranker/checker/expander/llm） |
| `rag.service.ts` | 入口：初始化依赖 + `streamQuery()` 创建 Readable → 编译图 → `invoke` 驱动 |

### 各阶段纯逻辑

| 组件 | 文件 | 职责 |
|------|------|------|
| `QueryRewriter` | `query-rewriter.ts` | 将复杂问题拆分为子查询（简单问题直接返回原问题，fail-open） |
| `hybridRetrieve` | `agent.ts` | 混合检索：向量相似度 × 0.6 + 元数据匹配 × 0.4，提取中英文关键词 |
| `SiliconFlowReranker` | `reranker.ts` | 调用 SiliconFlow Rerank API 精排文档，带 index 校验 |
| `SufficiencyChecker` | `sufficiency-checker.ts` | 中间草稿机制：先试答再判断，`missingInfo` 为可检索关键词数组，fail-closed + 正则降级提取 |
| `QueryExpander` | `query-expander.ts` | 根据缺失关键词数组生成定向检索查询，fail-open |

### 中间草稿机制（SufficiencyChecker）

与直接问"资料够不够"不同，强制 LLM 先写一版草稿答案，再审视草稿中哪些信息点写不出来（`[缺失：xxx]`），从而把元认知问题转化为具体动作——写不出来的地方就是缺失信息，其表述天然适合做二级检索关键词。

```ts
interface SufficiencyResult {
  sufficient: boolean;
  draft: string;        // 草稿答案（含 [缺失：xxx] 标注）
  missingInfo: string[]; // 可直接用于检索的关键词数组
  reason: string;
}
```

**容错策略**：JSON 整体解析失败时（通常是长草稿里出现未转义引号/换行破坏了 JSON 结构），用正则单独抢救 `sufficient` 和 `missingInfo`（fail-closed + fallbackExtract），保证核心判断和下游检索不中断。

## 节点直推流（流式输出）

每个节点函数接收对外的 `Readable` 流作为参数：

- **状态推送**：节点开头显式 `stream.push("[STATUS] xxx\n")`，不再从消息流里反推当前阶段
- **答案输出**：`generateNode` 内用 `llm.stream()` 逐 token `stream.push(text)`

前端契约不变：`[STATUS] xxx\n` 行为状态提示，其余字节为最终答案文本。

## 状态定义（Annotation.Root）

```ts
const RagState = Annotation.Root({
  query: Annotation<string>,                    // 用户原始问题
  subQueries: Annotation<string[]>({            // rewrite 产出的子查询
    reducer: (_, next) => next,                 // 每轮覆盖
  }),
  documents: Annotation<Document[]>({             // rerank 后的精排文档
    reducer: (_, next) => next,                 // 覆盖（retrieveNode 内部负责跨轮合并+去重）
  }),
  sufficiency: Annotation<SufficiencyResult | null>({
    reducer: (_, next) => next,
  }),
  iteration: Annotation<number>({                // 检索轮次计数
    reducer: (_, next) => next,
    default: () => 0,
  }),
});
```

**documents 的累积方式**：`rerankNode` 输出 top-N 后直接覆盖 state（落选文档不残留）；`retrieveNode` 在下一轮检索时将上一轮精排文档 + 本轮新检索文档按 `pageContent` 去重合并，再交给 rerank 处理。这样 reranker 每轮处理的文档量稳定，不会逐轮膨胀。

**迭代上限**：`MAX_ITERATIONS = 2`（额外检索轮数），由 `iteration` 计数器 + `routeAfterCheck` 条件边共同保证。达上限后强制转 generate，不无限循环。

## 检索细节

### 融合检索（hybridRetrieve）

```
用户查询 → 提取关键词(中文2+字/英文3+字母) → 向量检索(top 12)
                                              ↓
                         向量相似度 × 0.6 + 元数据匹配 × 0.4
                                              ↓
                                       排序取 top 6
```

元数据匹配检查 `document_title` 和 `section_title` 是否包含查询关键词。

### 多子查询检索

```
用户问题: "赵耀做过哪些项目？用过什么技术？"
    ↓
rewrite → ["赵耀的项目经历", "赵耀的技术栈"]
    ↓
子查询1 → hybridRetrieve(6) →┐
子查询2 → hybridRetrieve(6) →┴→ 合并去重 → rerank(top 3)
```

## 配置

### .env

```env
SILICONFLOW_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### RagConfig

```typescript
interface RagConfig {
  dbConfig: { ... };
  openrouterConfig: { ... };
  siliconflowConfig: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    rerankModel: string;  // BGE 重排序模型
  };
}
```

## 流式协议

前端通过 `[STATUS]` 前缀区分状态和内容（前端零改动，与 ReAct 时代一致）：

```
[STATUS] 正在拆分问题...
[STATUS] 正在检索相关信息...
[STATUS] 正在精排文档...
[STATUS] 正在检查信息充分性...
实际回答内容...
```

## 文件清单

### packages/ai-service/src/

```
rag.service.ts          # 入口：StateGraph 编排 + streamQuery
rag-graph.ts            # 图定义：状态/节点/条件边
agent.ts                # 纯逻辑依赖工厂（createRagDeps）
reranker.ts             # SiliconFlow Rerank API
sufficiency-checker.ts  # 中间草稿充分性检查
query-expander.ts       # 缺失关键词 → 定向查询
query-rewriter.ts       # 复杂问题 → 子查询
rag.config.ts           # 配置类型
index.ts                # 导出
```

### apps/api-server/src/rag/

```
rag.controller.ts       # HTTP 入口（零改动）
rag.service.ts          # 薄代理（零改动）
rag.module.ts           # DI（零改动）
```

## 已知问题

### 向量库 chunk 重复

`ingest.ts` 中 `RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 100 })` 对简历短文档切分过细，导致同一段内容出现多个重叠 chunk（如"专业技能"出现 3 次）。建议后续优化 chunk 策略：简历 section 级别的文档（几百到一千多字）适合整段入库不切分，或调大 `chunkSize` 到 1500+。

## 后续迭代计划

### Phase 3: 多数据源路由（Cross-Corpus Routing）

支持多个向量库/数据源，新增 Planner 节点决定检索哪个源。StateGraph 架构已为此做好准备（新增路由节点 + 条件边即可），无需再重构。

## 测试验证

- ✅ 简单问题："赵耀的学历是什么？" → rewrite → retrieve → rerank → check(充分) → generate
- ✅ 复杂问题："赵耀做过哪些项目？用过什么技术？" → rewrite 拆分 2 子查询 → 分别 retrieve → 合并 → rerank → check → generate
- ✅ 缺失信息迭代："赵耀在上一份工作里的职责和薪水" → rewrite → retrieve → rerank → check(不充分) → expand → retrieve → ... → 达上限 → generate（诚实回答缺失部分）
- ✅ 流程硬保证：图拓扑确保 rewrite → retrieve → rerank → check 顺序不可跳过
- ✅ 前端零改动：流式协议契约不变，状态提示和逐字回答正常显示
- ✅ 编译验证：`pnpm build:libs` 通过，`pnpm lint` 0 error
