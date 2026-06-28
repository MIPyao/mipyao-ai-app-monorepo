# AGENTS.md - AI 编码助手指南

## 项目概述

RAG 简历问答系统，用户可以通过聊天或语音查询赵耀的简历信息。基于 Agentic RAG 架构，使用 LangGraph StateGraph 驱动，支持查询拆分、混合检索、精排、充分性检查和智能迭代检索。

## 架构

```
apps/web-client (Next.js 16, 端口 4322)
       ↓ HTTP/SSE
apps/api-server (NestJS 11, 端口 4321)
       ↓
packages/ai-service (LangGraph StateGraph Agentic RAG)
packages/speech-service (ASR/TTS)
```

## Agentic RAG 流程

基于 LangGraph StateGraph 的显式状态图 + 条件边，不依赖 prompt 约束 LLM 行为：

```
START
  │
  ▼
rewrite ────────────────────────────┐  (复杂问题拆分为子查询，简单问题直接返回)
  │                                 │
  ▼                                 │
retrieve ◄──────────────────┐       │  (对每个子查询混合检索 top 6)
  │                         │       │
  ▼                         │       │
rerank ──────────────────────────────┘  (BGE 精排 top 3)
  │
  ▼
check ──(条件边)──► 充分 OR 迭代达上限(2轮) ──► generate ──► END
  │
  └──(不充分)──► expand ──► (回到 retrieve)
```

核心文件:
- `packages/ai-service/src/rag.service.ts` — 入口：StateGraph 编排 + streamQuery
- `packages/ai-service/src/rag-graph.ts` — 图定义：Annotation 状态 / 6 个节点 / 条件边 / createRagGraph 工厂
- `packages/ai-service/src/agent.ts` — 纯逻辑依赖工厂 (RagDeps) + 混合检索实现
- `packages/ai-service/src/query-rewriter.ts` — 查询拆分 (复杂问题 → 子查询)
- `packages/ai-service/src/reranker.ts` — SiliconFlow BGE 重排序
- `packages/ai-service/src/sufficiency-checker.ts` — 中间草稿充分性检查
- `packages/ai-service/src/query-expander.ts` — 缺失关键词定向查询

### StateGraph 状态定义

```ts
const RagState = Annotation.Root({
  query: Annotation<string>,                    // 用户原始问题
  subQueries: Annotation<string[]>({            // rewrite 产出的子查询（每轮覆盖）
    reducer: (_, next) => next,
  }),
  documents: Annotation<Document[]>({           // rerank 后的精排文档（覆盖）
    reducer: (_, next) => next,                 // retrieveNode 内部负责跨轮合并+去重
  }),
  sufficiency: Annotation<SufficiencyResult | null>({
    reducer: (_, next) => next,
  }),
  iteration: Annotation<number>({               // 检索轮次计数
    reducer: (_, next) => next,
    default: () => 0,
  }),
});
```

### 关键设计

- **中间草稿机制**: SufficiencyChecker 强制 LLM 先试答再审视缺失，把元认知问题转化为具体可检索关键词
- **documents 累积**: retrieveNode 将上一轮精排文档 + 本轮新检索文档按 pageContent 去重合并；rerank 输出 top-N 直接覆盖
- **混合检索**: 向量相似度 × 0.6 + 元数据匹配 × 0.4，提取中英文关键词匹配 document_title / section_title
- **流式协议**: 节点直推 Readable 流，`[STATUS] xxx\n` 为状态提示，其余字节为最终答案

## 启动命令

```bash
pnpm install          # 安装依赖
pnpm build:libs       # 构建 packages（修改 packages 后必须执行）
pnpm dev              # 同时启动前后端
pnpm start:api        # 只启动后端
pnpm start:web        # 只启动前端
pnpm lint             # 代码检查
pnpm format           # 代码格式化
```

## 数据库

```bash
docker-compose up -d  # 启动 PostgreSQL (端口 5000)
cd packages/ai-service && pnpm ingest:data  # 导入向量数据
```

## 环境变量

复制 `.env.example` 为 `.env`，配置 API Key：
- `OPENROUTER_API_KEY` - LLM (免费模型: openrouter/owl-alpha)
- `SILICONFLOW_API_KEY` - 嵌入模型 (BAAI/bge-m3) + 重排序 + ASR/TTS
- `SILICONFLOW_RERANK_MODEL` - 重排序模型 (BAAI/bge-reranker-v2-m3)

## 常见修改场景

### 修改前端 UI
- 组件在 `apps/web-client/src/components/`
- 样式用 Tailwind CSS 4，在 `globals.css` 中有自定义主题变量
- API 调用在 `apps/web-client/src/api/`

### 修改后端 API
- 控制器在 `apps/api-server/src/rag/` 和 `apps/api-server/src/speech/`
- 服务逻辑在对应的 `*.service.ts`
- 路由自动注册，Swagger 在 `/api-docs`

### 修改 AI/RAG 逻辑
- StateGraph 图定义在 `packages/ai-service/src/rag-graph.ts`
- 纯逻辑依赖在 `packages/ai-service/src/agent.ts` (createRagDeps)
- 各阶段逻辑：`query-rewriter.ts`, `reranker.ts`, `sufficiency-checker.ts`, `query-expander.ts`
- 入口服务在 `packages/ai-service/src/rag.service.ts`
- 修改后需重新构建: `pnpm build:libs`

### 修改语音功能
- ASR/TTS 在 `packages/speech-service/src/`
- 前端组件: `VoiceInput.tsx`, `StreamAudioPlayer.tsx`

## 注意事项

- **端口**: 后端 4321，前端 4322（避开 Hyper-V 保留的 3521-4220）
- **Hyper-V**: Windows 上 3521-4220 端口段被 Hyper-V 占用
- **LLM 模型**: `openrouter/owl-alpha` 不支持 `stream_options` 参数，已配置 `streamUsage: false`
- **TTS 收费**: SiliconFlow TTS 开始收费，前端 TTS 开关关闭时不会调用 TTS API
- **Agent 日志**: 后端控制台会输出 Agent 执行过程（rewrite → retrieve → rerank → check → generate）

## 代码规范

- TypeScript 严格模式
- React 函数组件 (Next.js App Router)
- 格式化: Prettier
- Lint: Oxlint
- 提交信息: 中英文均可，格式 `<type>: <description>`

## 已完成迭代

- Phase 1: Agentic RAG — 混合检索 + BGE 精排 + 充分性检查 + 迭代补全
- Phase 2: Query Rewriter — 复杂问题拆分为子查询，StateGraph 迁移

## 未来迭代计划

- Phase 3: 多数据源路由 (Cross-Corpus Routing) — 支持多数据源检索，StateGraph 架构已为此做好准备
