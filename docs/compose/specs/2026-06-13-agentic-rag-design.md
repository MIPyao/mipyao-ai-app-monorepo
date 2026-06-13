# Agentic RAG 升级设计文档

**日期**: 2026-06-13
**分支**: `feature/agentic-rag`
**状态**: 设计完成，待实现

---

## [S1] 问题

当前 RAG 是单次检索 + 单次 LLM 调用。当用户问题涉及多个信息维度（如"赵耀做过哪些项目？用过什么技术？"），信息可能分散在不同文档中，单次检索只能找到部分信息，导致回答不完整。

---

## [S2] 方案概述

升级为 Agentic RAG：加入**重排序**、**充分性检查**、**迭代检索**。用 LangChain Agent（`createReactAgent`）替代固定管道（RunnableSequence），实现动态决策流程。

---

## [S3] 架构

### 核心流程

```
用户问题
    ↓
┌─────────────────┐
│  Agent (循环)    │
│  ┌───────────┐  │
│  │ retrieve  │  │  ← 工具1: 融合检索 top 6
│  │ rerank    │  │  ← 工具2: BGE Reranker 精排 top 3
│  │ check     │  │  ← 工具3: LLM 充分性检查
│  │ expand    │  │  ← 工具4: 查询扩展（迭代时用）
│  └───────────┘  │
│       ↓         │
│  充分？ → 流式输出最终回答
│  不充分？ → expand → retrieve（最多2轮）
└─────────────────┘
```

### 与现有代码的关系

| 现有 | 升级后 |
|------|--------|
| `RunnableSequence` (LCEL) | `createReactAgent` (LangGraph) |
| `hybridRetrieve()` | 保留，封装为 Agent Tool |
| `RAG_PROMPT_TEMPLATE` | 保留，作为 Agent 的 system prompt |
| 无重排序 | 新增 `SiliconFlowReranker` |
| 无充分性检查 | 新增 `SufficiencyChecker` |
| 无迭代 | Agent 自动处理迭代 |

---

## [S4] 组件设计

### 4.1 SiliconFlowReranker

**文件**: `packages/ai-service/src/reranker.ts`

用 SiliconFlow 的 Rerank API（兼容 Cohere 格式），模型配置从 .env 读取。

```typescript
export class SiliconFlowReranker {
  constructor(config: { apiKey: string; baseUrl: string; model: string }) {}

  async rerank(query: string, documents: Document[], topN: number = 3): Promise<Document[]>
}
```

### 4.2 SufficiencyChecker

**文件**: `packages/ai-service/src/sufficiency-checker.ts`

用 LLM 判断检索到的上下文是否足以回答问题，输出 JSON 格式的判断结果。

```typescript
export class SufficiencyChecker {
  constructor(llm: ChatOpenAI) {}

  async check(query: string, context: string): Promise<{
    sufficient: boolean;
    missingInfo: string;
    reason: string;
  }>
}
```

### 4.3 QueryExpander

**文件**: `packages/ai-service/src/query-expander.ts`

第二轮迭代时，根据 missingInfo 生成更宽泛的搜索查询。

```typescript
export class QueryExpander {
  constructor(llm: ChatOpenAI) {}

  async expand(query: string, missingInfo: string, foundInfo: string): Promise<string>
}
```

### 4.4 Agent Tools

将上述组件封装为 LangChain Tools：

```typescript
// Agent 可调用的 4 个工具
const tools = [
  retrieveTool,      // 调用 hybridRetrieve
  rerankTool,        // 调用 SiliconFlowReranker
  checkTool,         // 调用 SufficiencyChecker
  expandTool,        // 调用 QueryExpander
];
```

### 4.5 Agent 本身

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const agent = createReactAgent({
  llm,
  tools,
  messageModifier: SYSTEM_PROMPT,  // 现有的 system prompt
});
```

---

## [S5] 流式协议

### 状态前缀

迭代过程中，前端需要看到中间状态：

```
[STATUS] 正在检索相关信息...
[STATUS] 已找到 3 条信息，进行质量评估...
[STATUS] 信息不完整，正在深入搜索...
[STATUS] 搜索完成，开始生成回答...
实际回答内容开始流式输出...
```

### 前端处理

```typescript
// Chat.tsx
if (chunk.startsWith("[STATUS] ")) {
  setStatus(chunk.slice(9));  // 显示在输入框上方
} else {
  appendToMessage(chunk);     // 正常消息内容
}
```

---

## [S6] 配置变更

### .env 新增

```env
# --- Reranker 配置 ---
SILICONFLOW_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### rag.config.ts 新增

```typescript
export interface RagConfig {
  // ... 现有配置
  siliconflowConfig: {
    // ... 现有配置
    rerankModel: string;  // 新增
  };
}
```

---

## [S7] 文件改动清单

### 新增文件

```
packages/ai-service/src/reranker.ts              # 重排序封装
packages/ai-service/src/sufficiency-checker.ts   # 充分性检查
packages/ai-service/src/query-expander.ts        # 查询扩展
packages/ai-service/src/agent.ts                 # Agent 定义和工具注册
```

### 修改文件

```
packages/ai-service/src/rag.service.ts            # 核心：用 Agent 替代 RunnableSequence
packages/ai-service/src/rag.config.ts            # 添加 rerankModel 配置
packages/ai-service/src/index.ts                 # 导出新组件
apps/web-client/src/components/Chat.tsx          # 处理 [STATUS] 消息
.env                                              # 添加 SILICONFLOW_RERANK_MODEL
```

---

## [S8] 性能预期

| 场景 | 延迟增加 | 说明 |
|------|---------|------|
| 信息充分（最好） | +0.5-1s | 只多一次 rerank + 充分性检查 |
| 需要 1 轮迭代 | +2-3s | 多一次检索 + 扩展查询 |
| 需要 2 轮迭代 | +4-5s | 最多迭代 2 次 |

---

## [S9] 未来路线图（本次不实现）

### Phase 2: 查询重写 (Query Rewriter)

把复杂问题拆成多个子查询，比如：
- 输入："赵耀做过哪些项目？用过什么技术？"
- 输出：["赵耀的项目经历", "赵耀的技术栈"]

### Phase 3: 多数据源路由 (Cross-Corpus Routing)

支持从多个数据源检索，Agent 自动选择从哪个数据源查询。比如简历数据、项目文档、博客文章等。

---

## [S10] 依赖安装

需要安装 LangGraph：

```bash
pnpm add @langchain/langgraph
```

> 注意：当前 pnpm store 路径有冲突，需要先运行 `pnpm install` 修复，或设置 `pnpm config set store-dir G:\.pnpm-store\v10 --global`
