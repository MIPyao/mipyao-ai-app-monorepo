# AGENTS.md - AI 编码助手指南

## 项目概述

RAG 简历问答系统，用户可以通过聊天或语音查询赵耀的简历信息。基于 Agentic RAG 架构，支持智能迭代检索。

## 架构

```
apps/web-client (Next.js, 端口 4322)
       ↓ HTTP/SSE
apps/api-server (NestJS, 端口 4321)
       ↓
packages/ai-service (LangGraph Agent RAG)
packages/speech-service (ASR/TTS)
```

## Agentic RAG 流程

```
用户问题 → Agent 循环:
  1. retrieve (top 6)      ← 向量检索
  2. rerank (top 3)        ← BGE 重排序
  3. check_sufficiency     ← LLM 判断信息是否充分
  4. 不充分 → expand_query → 回到 1（最多 2 轮）
  5. 充分 → 生成回答
```

核心文件:
- `packages/ai-service/src/rag.service.ts` — Agent 主逻辑
- `packages/ai-service/src/agent.ts` — 4 个 LangChain Tools
- `packages/ai-service/src/reranker.ts` — SiliconFlow 重排序
- `packages/ai-service/src/sufficiency-checker.ts` — 充分性检查
- `packages/ai-service/src/query-expander.ts` — 查询扩展

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
- 样式用 Tailwind CSS，在 `globals.css` 中有自定义主题变量
- API 调用在 `apps/web-client/src/api/`

### 修改后端 API
- 控制器在 `apps/api-server/src/rag/` 和 `apps/api-server/src/speech/`
- 服务逻辑在对应的 `*.service.ts`
- 路由自动注册，Swagger 在 `/api-docs`

### 修改 AI/RAG 逻辑
- Agent 核心在 `packages/ai-service/src/rag.service.ts`
- System Prompt 在同文件顶部 `AGENT_SYSTEM_PROMPT`
- Agent Tools 在 `packages/ai-service/src/agent.ts`
- 修改后需重新构建: `pnpm build:libs`

### 修改语音功能
- ASR/TTS 在 `packages/speech-service/src/`
- 前端组件: `VoiceInput.tsx`, `StreamAudioPlayer.tsx`

## 注意事项

- **端口**: 后端 4321，前端 4322（避开 Hyper-V 保留的 3521-4220）
- **Hyper-V**: Windows 上 3521-4220 端口段被 Hyper-V 占用
- **LLM 模型**: `openrouter/owl-alpha` 不支持 `stream_options` 参数，已配置 `streamUsage: false`
- **TTS 收费**: SiliconFlow TTS 开始收费，前端 TTS 开关关闭时不会调用 TTS API
- **Agent 日志**: 后端控制台会输出 Agent 执行过程（检索、重排序、充分性检查）

## 代码规范

- TypeScript 严格模式
- 使用 Composition API (Vue) 或函数组件 (React)
- 格式化: Prettier
- Lint: Oxlint
- 提交信息: 中英文均可，格式 `<type>: <description>`

## 未来迭代计划

- Phase 2: 查询重写 (Query Rewriter) — 把复杂问题拆成子查询
- Phase 3: 多数据源路由 (Cross-Corpus Routing) — 支持多数据源检索
