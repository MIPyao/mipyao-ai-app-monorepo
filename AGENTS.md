# AGENTS.md - AI 编码助手指南

## 项目概述

RAG 简历问答系统，用户可以通过聊天或语音查询赵耀的简历信息。

## 架构

```
apps/web-client (Next.js, 端口 4001)
       ↓ HTTP/SSE
apps/api-server (NestJS, 端口 4000)
       ↓
packages/ai-service (LangChain RAG)
packages/speech-service (ASR/TTS)
```

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
- `SILICONFLOW_API_KEY` - 嵌入模型 (BAAI/bge-m3) + ASR/TTS

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
- 核心在 `packages/ai-service/src/rag.service.ts`
- Prompt 模板在同文件顶部 `RAG_PROMPT_TEMPLATE`
- 修改后需重新构建: `pnpm build:libs`

### 修改语音功能
- ASR/TTS 在 `packages/speech-service/src/`
- 前端组件: `VoiceInput.tsx`, `StreamAudioPlayer.tsx`

## 注意事项

- **端口**: 后端 4000，前端 4001（避开 Hyper-V 保留的 3000-3099）
- **Hyper-V**: Windows 上 2700-3399 端口段可能被 Hyper-V 占用
- **LLM 模型**: `openrouter/owl-alpha` 不支持 `stream_options` 参数，已配置 `streamUsage: false`
- **TTS 收费**: SiliconFlow TTS 开始收费，前端 TTS 开关关闭时不会调用 TTS API

## 代码规范

- TypeScript 严格模式
- 使用 Composition API (Vue) 或函数组件 (React)
- 格式化: Prettier
- Lint: Oxlint
- 提交信息: 中英文均可，格式 `<type>: <description>`
