# Agentic RAG 特性总结

**分支**: `feature/agentic-rag`
**状态**: 最小规格实现完成，待合并后继续迭代
**日期**: 2026-06-14

---

## 概述

将 RAG 从单次检索升级为 Agentic RAG，加入重排序、充分性检查、迭代检索。用 LangChain Agent（`createReactAgent`）替代固定管道（RunnableSequence），实现动态决策流程。

## 架构变更

### 之前

```
用户问题 → hybridRetrieve(top3) → Prompt → LLM → 流式输出
           (单次检索，无迭代)        (静态模板)    (单次调用)
```

### 之后

```
用户问题 → [Agent 循环]
              ↓
           retrieve (top 6)      ← 向量检索
              ↓
           rerank (top 3)        ← BGE 重排序
              ↓
           check_sufficiency     ← LLM 判断信息是否充分
              ↓
         ┌── 充分 → 生成回答
         └── 不充分 → expand_query → 回到 retrieve（最多 2 轮）
```

## 新增组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `SiliconFlowReranker` | `reranker.ts` | 调用 SiliconFlow Rerank API 精排文档 |
| `SufficiencyChecker` | `sufficiency-checker.ts` | 用 LLM 判断检索信息是否充分 |
| `QueryExpander` | `query-expander.ts` | 根据缺失信息生成新搜索查询 |
| Agent Tools | `agent.ts` | 封装 4 个 LangChain Tool |
| RagService (重构) | `rag.service.ts` | 用 `createReactAgent` 替代 `RunnableSequence` |

## 配置变更

### .env 新增

```env
SILICONFLOW_RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### RagConfig 新增

```typescript
rerankModel: string;  // 在 siliconflowConfig 下
```

## 流式协议

前端通过 `[STATUS]` 前缀区分状态和内容：

```
[STATUS] 正在检索相关信息...
[STATUS] 已找到 3 条信息，进行质量评估...
实际回答内容开始流式输出...
```

## 文件改动清单

### 新增文件

```
packages/ai-service/src/reranker.ts
packages/ai-service/src/sufficiency-checker.ts
packages/ai-service/src/query-expander.ts
packages/ai-service/src/agent.ts
docs/compose/specs/2026-06-13-agentic-rag-design.md
docs/compose/plans/2026-06-14-agentic-rag-plan.md
docs/features/agentic-rag.md
```

### 修改文件

```
packages/ai-service/src/rag.service.ts    # 核心：RunnableSequence → createReactAgent
packages/ai-service/src/rag.config.ts    # 添加 rerankModel
packages/ai-service/src/index.ts         # 导出新组件
apps/api-server/src/main.ts              # 端口 4000 → 4321
apps/api-server/src/rag/rag.module.ts    # 传递 rerankModel 配置
apps/web-client/package.json             # 端口 4001 → 4322
apps/web-client/src/components/Chat.tsx          # 处理 [STATUS] 消息
apps/web-client/src/components/ChatMessage.tsx   # 显示状态指示器
apps/web-client/src/components/VoiceInput.tsx    # 修复 ASR bug (type="button")
apps/web-client/src/types/index.ts               # Message 类型添加 status
.env                                            # 添加 rerank 配置
.env.example                                    # 同步配置模板
```

## Bug 修复

1. **ASR 自动开启** — VoiceInput 按钮缺少 `type="button"`，Enter 提交表单时意外触发录音
2. **端口冲突** — Hyper-V 保留 3521-4220 端口段，后端改用 4321，前端改用 4322
3. **LLM streamOptions** — `openrouter/owl-alpha` 不支持 `stream_options`，已配置 `streamUsage: false`

## 后续迭代计划

### Phase 2: 查询重写 (Query Rewriter)

把复杂问题拆成多个子查询，比如：
- 输入："赵耀做过哪些项目？用过什么技术？"
- 输出：["赵耀的项目经历", "赵耀的技术栈"]

### Phase 3: 多数据源路由 (Cross-Corpus Routing)

支持从多个数据源检索，Agent 自动选择从哪个数据源查询。

## 测试验证

- ✅ 简单问题："赵耀的学历是什么？" → 单次检索即可回答
- ✅ 复杂问题："赵耀做过哪些项目？用过什么技术？" → retrieve → rerank → check_sufficiency → 回答
- ✅ 缺失信息："赵耀的薪资情况" → 检测到信息不充分，返回提示
- ✅ 构建验证：`pnpm build:libs` 通过
