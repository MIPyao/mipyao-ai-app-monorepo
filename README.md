# MIPYao AI 简历助手

一个基于 RAG (检索增强生成) 技术的智能简历问答系统，使用 Next.js、NestJS 和 LangChain.js 构建。

## 📸 运行截图

![运行截图 1](./image/image-1.png)

![运行截图 2](./image/image-2.png)

## 🏗️ 项目架构

本项目采用 **Monorepo** 架构，使用 `pnpm workspace` 管理多个包和应用。

### 整体架构图

```
┌─────────────────┐
│   Web Client    │  Next.js 前端应用 (端口 3001)
│   (Next.js)     │
└────────┬────────┘
         │ HTTP 请求
         ▼
┌─────────────────┐
│   API Server    │  NestJS 后端服务 (端口 3000)
│   (NestJS)      │
└────────┬────────┘
         │ 调用
         ▼
┌─────────────────┐
│   AI Service    │  RAG 核心服务包
│  (LangChain)    │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│ Ollama │ │PostgreSQL│
│  LLM   │ │ pgvector │
└────────┘ └──────────┘
```

### 1. 前端服务 (Web Client)

**位置**: `apps/web-client`

**技术栈**:

- **Next.js 16** - React 框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **Lucide React** - 图标库
- **React Markdown** - Markdown 渲染

**主要功能**:

- 用户界面展示
- 聊天交互组件
- 流式响应处理
- 欢迎屏幕与建议问题

**核心组件**:

- `Chat.tsx` - 主聊天组件
- `ChatMessage.tsx` - 消息展示组件
- `WelcomeScreen.tsx` - 欢迎界面组件

### 2. 后端服务 (API Server)

**位置**: `apps/api-server`

**技术栈**:

- **NestJS** - Node.js 企业级框架
- **TypeScript** - 类型安全
- **Swagger** - API 文档

**主要功能**:

- RESTful API 接口
- 流式响应处理
- 错误处理与日志记录
- API 文档自动生成

**核心接口**:

- `GET /rag/stream?query=xxx` - 流式 RAG 问答接口

### 3. AI 服务 (AI Service)

**位置**: `packages/ai-service`

**技术栈**:

- **LangChain** - LLM 应用框架
- **Ollama** - 本地 LLM 运行环境
- **PostgreSQL + pgvector** - 向量数据库

**主要功能**:

- 文档向量化与存储
- 相似度检索 (RAG)
- LLM 问答生成
- 流式输出支持

**核心服务**:

- `RagService` - RAG 核心服务类
- 支持文档导入 (Ingestion)
- 支持流式查询 (Streaming Query)

**数据流程**:

1. 文档导入 → 文本分割 → 向量化 → 存储到 PostgreSQL
2. 用户查询 → 向量检索 → 上下文构建 → LLM 生成回答

## 🛠️ 技术栈

### 前端

- Next.js 16.0.8
- React 19.2.1
- TypeScript 5
- Tailwind CSS 4

### 后端

- NestJS 11
- TypeScript 5.7.3
- Express

### AI 服务

- LangChain 1.1.5
- Ollama (本地 LLM)
- PostgreSQL 16 + pgvector

### 开发工具

- pnpm 10.25.0 (包管理器)
- TypeScript
- Prettier (代码格式化)
- Oxlint (代码检查)

## 🚀 快速开始

### 前置要求

1. **Node.js** >= 18
2. **pnpm** >= 10.25.0
3. **Docker** 和 **Docker Compose** (用于运行 PostgreSQL)
4. **Ollama** (本地 LLM 服务)

### 安装 Ollama

访问 [Ollama 官网](https://ollama.ai/) 下载并安装。

启动 Ollama 服务后，拉取所需的模型：

```bash
# 拉取嵌入模型
ollama pull nomic-embed

# 拉取 LLM 模型 (推荐使用 Qwen1.8B 或其他小模型)
ollama pull qwen2.5:1.8b
```

### 环境配置

在项目根目录创建 `.env` 文件（如果不存在），配置以下环境变量：

#### 使用 Gemini API（推荐）

```env
# PostgreSQL 数据库配置
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=ai_rag_db
POSTGRES_USER=rag_user
POSTGRES_PASSWORD=rag_password
POSTGRES_TABLE_NAME=documents

# Gemini API 配置
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_EMBEDDING_MODEL=embedding-001
# 注意：模型名称必须正确，v1beta API 不支持 -latest 后缀

# 重要：向量维度必须与嵌入模型匹配
# embedding-001 输出 768 维向量
POSTGRES_DIMENSIONS=768

# API 服务配置
NESTJS_API_BASE_URL=http://localhost:3000
```

#### 使用 Ollama（本地部署）

```env
# PostgreSQL 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_rag_db
DB_USER=rag_user
DB_PASSWORD=rag_password

# Ollama 配置
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed
LLM_MODEL=qwen2.5:1.8b

# API 服务配置
NESTJS_API_BASE_URL=http://localhost:3000
```

### 启动步骤

#### 1. 安装依赖

```bash
pnpm install
```

#### 2. 启动 PostgreSQL 数据库

```bash
docker-compose up -d
```

等待数据库启动完成（约 10-30 秒）。

#### 3. 构建 AI 服务包

```bash
pnpm build:libs
```

#### 4. 导入数据到向量数据库

```bash
cd packages/ai-service
pnpm ingest:data
```

这将读取 `packages/ai-service/data/` 目录下的简历文件，进行向量化并存储到数据库。

#### 5. 启动开发服务器

在项目根目录运行：

```bash
pnpm dev
```

这将同时启动：

- **API 服务器**: http://localhost:3000
- **Web 客户端**: http://localhost:3001

### 单独启动服务

如果需要单独启动某个服务：

```bash
# 只启动 API 服务器
pnpm start:api

# 只启动 Web 客户端
pnpm start:web
```

## 📝 可用脚本

### 根目录脚本

```bash
# 构建所有库
pnpm build:libs

# 构建所有应用
pnpm build:apps

# 构建所有项目
pnpm build:all

# 启动开发环境（并行启动所有服务）
pnpm dev

# 单独启动 API 服务器
pnpm start:api

# 单独启动 Web 客户端
pnpm start:web

# 代码格式化
pnpm format

# 代码检查
pnpm lint
```

### AI 服务脚本

```bash
cd packages/ai-service

# 导入数据
pnpm ingest:data

# 测试 RAG 功能
pnpm test:rag
```

## 📁 项目结构

```
mipyao-ai-app-monorepo/
├── apps/
│   ├── api-server/          # NestJS 后端服务
│   │   ├── src/
│   │   │   ├── rag/         # RAG 控制器和服务
│   │   │   └── main.ts      # 应用入口
│   │   └── package.json
│   └── web-client/          # Next.js 前端应用
│       ├── src/
│       │   ├── app/         # Next.js App Router
│       │   ├── components/  # React 组件
│       │   └── lib/         # 工具函数
│       └── package.json
├── packages/
│   └── ai-service/          # RAG 核心服务包
│       ├── src/
│       │   ├── rag.service.ts    # RAG 服务实现
│       │   └── rag.config.ts     # 配置接口
│       ├── data/            # 简历数据文件
│       └── scripts/         # 数据导入和测试脚本
├── image/                   # 项目截图
├── docker-compose.yaml      # PostgreSQL 容器配置
├── pnpm-workspace.yaml      # pnpm workspace 配置
└── package.json            # 根 package.json
```

## 🔧 开发说明

### 添加新的简历数据

1. 将简历文本文件放入 `packages/ai-service/data/` 目录
2. 运行 `pnpm ingest:data` 重新导入数据

### 修改 AI 模型

在 `.env` 文件中修改 `EMBEDDING_MODEL` 和 `LLM_MODEL` 环境变量。

### API 文档

启动 API 服务器后，访问 http://localhost:3000/api 查看 Swagger API 文档。

## 🐛 故障排除

### 数据库连接失败

- 确保 Docker 容器正在运行：`docker ps`
- 检查数据库端口 5432 是否被占用
- 验证 `.env` 文件中的数据库配置

### Gemini API 模型名称错误

如果遇到 `404 Not Found` 错误：

- **重要**：v1beta API 不支持 `-latest` 后缀
- 检查 `.env` 文件中的 `GEMINI_LLM_MODEL` 环境变量
- 使用正确的模型名称
- 确保 `GEMINI_API_KEY` 已正确设置
- 运行 `pnpm list:models` 查看所有可用的模型列表

### Ollama 连接失败

- 确保 Ollama 服务正在运行：`ollama list`
- 检查 `OLLAMA_BASE_URL` 环境变量是否正确
- 确认所需的模型已下载：`ollama list`

### 前端无法连接后端

- 检查 `NEXT_PUBLIC_NESTJS_API_BASE_URL` 环境变量
- 确认 API 服务器正在运行在端口 3000
- 检查浏览器控制台的网络请求错误

## 📄 许可证

ISC

## 👤 作者

MIPyao
