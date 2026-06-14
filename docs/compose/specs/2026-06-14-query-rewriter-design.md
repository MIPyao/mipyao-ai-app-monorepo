# Phase 2: Query Rewriter 设计文档

**日期**: 2026-06-14
**分支**: `feature/agentic-rag`
**状态**: 设计完成，待实现

---

## [S1] 问题

当前 Agent 在处理复杂多维度问题时（如"赵耀做过哪些项目？用过什么技术？"），会用一个合并的查询去检索，可能导致部分信息召回不充分。需要在检索前将复杂问题拆分为多个子查询，分别检索后合并。

---

## [S2] 方案概述

新增 `QueryRewriter` 组件和 `rewrite_query` Agent 工具，在 retrieve 之前由 Agent 决定是否需要拆分查询。复杂问题拆分为多个子查询，分别检索后合并结果。

---

## [S3] 架构

### 核心流程

```
用户问题
    ↓
Agent 判断是否复杂
    ↓ (复杂)
调用 rewrite_query → 得到子查询列表 ["子查询1", "子查询2"]
    ↓
Agent 对每个子查询调用 retrieve → 合并检索结果
    ↓
rerank → check_sufficiency → 生成回答
```

### 与现有代码的关系

| 现有 | Phase 2 新增 |
|------|-------------|
| retrieve tool | Agent 对多个子查询分别调用 |
| expand_query tool | 用于迭代检索（保留） |
| 无查询重写 | 新增 rewrite_query tool |

---

## [S4] 组件设计

### 4.1 QueryRewriter

**文件**: `packages/ai-service/src/query-rewriter.ts`

用 LLM 判断问题复杂度并拆分为子查询，同时对每个子查询做检索友好化改写。

```typescript
export class QueryRewriter {
  constructor(llm: ChatOpenAI) {}

  async rewrite(question: string): Promise<string[]>
}
```

### 4.2 rewrite_query 工具

**文件**: `packages/ai-service/src/agent.ts`

封装 QueryRewriter 为 Agent 可调用的工具，返回 JSON 格式的子查询列表。

```typescript
const rewriteTool = tool(
  async ({ question }) => {
    const queries = await rewriter.rewrite(question);
    return JSON.stringify({ queries });
  },
  {
    name: "rewrite_query",
    description: "将复杂问题拆分为多个子查询，用于分别检索。",
    schema: z.object({
      question: z.string().describe("用户原始问题"),
    }),
  }
);
```

---

## [S5] System Prompt 更新

在 Agent 的 system prompt 中添加重写相关指令：

```
你现在有以下工具可用：
- rewrite_query: 将复杂问题拆分为多个子查询
- retrieve: 从简历数据库检索信息
- rerank: 对检索结果重排序
- check_sufficiency: 检查信息是否充分
- expand_query: 生成更精准的搜索查询

工作流程：
1. 如果问题涉及多个主题（如"做过什么项目？用过什么技术？"），先调用 rewrite_query 拆分
2. 对每个子查询调用 retrieve 检索
3. 合并所有检索结果
4. 调用 rerank 精排
5. 调用 check_sufficiency 检查
6. 信息充分后生成回答
```

---

## [S6] 文件改动清单

### 新增文件

```
packages/ai-service/src/query-rewriter.ts    # QueryRewriter 类
```

### 修改文件

```
packages/ai-service/src/agent.ts             # 添加 rewrite_query 工具
packages/ai-service/src/rag.service.ts       # 更新 system prompt
packages/ai-service/src/index.ts             # 导出 QueryRewriter
```

---

## [S7] 性能预期

| 场景 | 延迟变化 | 说明 |
|------|---------|------|
| 简单问题（不重写） | 无变化 | Agent 跳过 rewrite_query |
| 复杂问题（重写+多次检索） | +1-2s | 多一次 LLM 调用 + 多次检索 |

---

## [S8] 测试验证

- ✅ 简单问题："赵耀的学历是什么？" → 不触发重写，直接检索
- ✅ 复杂问题："赵耀做过哪些项目？用过什么技术？" → 触发重写，拆分为 2 个子查询
- ✅ 构建验证：`pnpm build:libs` 通过
