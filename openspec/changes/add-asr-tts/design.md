## Context

MIPYao 简历助手是一个基于 RAG 的智能问答系统，当前仅支持文本交互。系统架构为 Monorepo：

- `apps/web-client` - Next.js 16 前端
- `apps/api-server` - NestJS 11 后端
- `packages/ai-service` - LangChain RAG 核心服务

现有依赖：OpenRouter (LLM)、SiliconFlow (Embeddings)、PostgreSQL + pgvector。

**约束条件**：

- 前端需兼容现代浏览器（Chrome, Firefox, Safari, Edge）
- 保持现有 RAG 查询流程不变，语音功能作为新的交互方式
- TTS 需要支持流式输出，实现边生成边播放

## 架构原则：三明治架构（Sandwich Architecture）

采用 LangChain 官方推荐的三明治架构模式：

```
用户语音 → ASR → LangChain (RAG/Agent) → TTS → 用户听到语音
              ↑                           ↑
         speech-service              speech-service
```

**核心原则**：

- `ai-service`（LangChain）：**只处理文本**，专注 RAG 和 Agent
- `speech-service`：**独立处理音频**，ASR/TTS 不混入 LangChain
- `api-server`：作为协调层，编排语音和 AI 的调用流程

**为什么 ASR/TTS 不放在 ai-service 里**：

1. LangChain 的 Chain/Runnable 接口不适合处理音频流
2. 音频处理和文本推理是不同的技术领域
3. 职责分离让代码更清晰、更易维护
4. 符合 LangChain 官方推荐的架构模式

## Goals / Non-Goals

**Goals:**

- 用户可以通过语音输入问题（ASR）
- 用户可以听取 AI 回答的语音朗读，且是实时流式的（LLM 输出的同时就开始播放）
- 语音交互与现有文本交互无缝集成
- 低延迟响应（ASR < 3s, TTS 首字节 < 500ms）

**Non-Goals:**

- 实时语音对话（语音打断、连续对话）
- 语音克隆或个性化音色
- 多语言支持（仅中文）
- 离线语音处理

## Decisions

### 1. TTS 架构：流式文本转流式语音

**核心设计**：LLM 生成文本流 → 分句/分段 → 流式调用 TTS → 流式返回音频 → 前端实时播放

**流程**：

```
LLM Stream (text chunks)
    ↓
文本缓冲 + 分句检测（。！？\n）
    ↓
流式 TTS API 调用（每个句子）
    ↓
音频流返回 (MP3/Opus chunks)
    ↓
前端 Audio Buffer + 播放队列
    ↓
实时播放
```

**关键点**：

- 后端需要同时消费 LLM 文本流和生产 TTS 音频流
- 使用 SSE (Server-Sent Events) 或 WebSocket 实现双向流
- 前端需要音频缓冲队列，确保播放连续性

### 2. TTS 服务选型：Edge-TTS（推荐）

**Edge-TTS（微软）** - 推荐首选

- ✅ 完全免费，无需 API Key
- ✅ 原生支持流式输出
- ✅ 中文音质优秀（使用微软 Azure TTS 引擎）
- ✅ Node.js 库成熟（`edge-tts` npm 包）
- ✅ 支持多种中文音色（晓晓、云希、云扬等）
- 缺点：需要 Node.js 环境运行，非 HTTP API

**备选方案**：

| 服务                    | 优点             | 缺点                       |
| ----------------------- | ---------------- | -------------------------- |
| SiliconFlow TTS         | 复用 API Key     | 需确认流式支持             |
| OpenRouter TTS          | 复用 API Key     | 模型选择有限               |
| Hugging Face ONNX       | 完全本地，无网络 | 流式实现复杂，需要模型文件 |
| Browser SpeechSynthesis | 零成本           | 音质差，不支持流式         |

**最终决定**：默认使用 Edge-TTS，可通过配置切换到其他服务

### 3. ASR 服务选型

**SiliconFlow ASR** - 推荐首选

- ✅ 项目已在使用，复用 API Key
- ✅ 免费额度
- ✅ 支持中文识别
- 模型：`FunAudioLLM/SenseVoiceSmall`（免费）

**备选**：

- OpenRouter ASR（如果支持）
- 浏览器 SpeechRecognition API（兼容性差）

### 4. 流式 TTS 实现方案

**方案 A：SSE + 后端流式处理（推荐）**

```
前端 POST /rag/stream-with-tts
    ↓
后端接收查询
    ↓
并行：
├── LLM Stream → 文本流 → 前端显示
└── 文本流 → 分句 → TTS Stream → 音频流 → 前端播放
```

优点：

- 复用现有 `/rag/stream` 接口模式
- SSE 实现简单，浏览器原生支持
- 前后端解耦

**方案 B：WebSocket 双向通信**

优点：

- 真正的双向流
- 可以实现语音打断

缺点：

- 实现复杂
- 需要 WebSocket 服务器

**最终决定**：使用 SSE 方案，保持架构简单

### 5. 音频流处理

**后端**：

- 使用 `edge-tts` 的流式 API
- 将 TTS 音频 chunk 通过 SSE 发送给前端
- 音频格式：MP3（edge-tts 默认输出）

**前端**：

- 使用 `MediaSource API` 或 `AudioContext` 实现流式播放
- 维护音频播放队列，确保连续性
- 支持暂停/恢复

### 6. 音频格式

- **录制格式**：WebM with Opus codec（MediaRecorder 原生支持）
- **播放格式**：MP3（edge-tts 输出，兼容性最好）
- **备选**：Opus（更小体积，但浏览器兼容性略差）

### 7. 前端状态管理

语音功能需要新增以下状态：

- `isRecording: boolean` - 是否正在录音
- `recordingTime: number` - 录音时长（秒）
- `isStreamingTTS: boolean` - 是否正在流式播放 TTS
- `ttsEnabled: boolean` - TTS 开关（用户可关闭）
- `audioQueue: ArrayBuffer[]` - 音频播放队列

使用 React useState + useRef 管理。

## 模块结构

### 新建：packages/speech-service

```
packages/speech-service/
├── src/
│   ├── asr/
│   │   ├── asr.interface.ts      # ASR 接口定义
│   │   ├── siliconflow.asr.ts    # SiliconFlow ASR 实现
│   │   └── index.ts
│   ├── tts/
│   │   ├── tts.interface.ts      # TTS 接口定义
│   │   ├── edge.tts.ts           # Edge-TTS 实现（流式）
│   │   ├── siliconflow.tts.ts    # SiliconFlow TTS 备选
│   │   └── index.ts
│   ├── stream/
│   │   ├── text-splitter.ts      # 文本分句工具
│   │   └── audio-buffer.ts       # 音频流缓冲
│   ├── speech.config.ts          # 配置接口
│   ├── speech.factory.ts         # 服务工厂（按配置创建实例）
│   └── index.ts                  # 统一导出
├── package.json
└── tsconfig.json
```

**特点**：

- 不依赖 LangChain，纯音频处理
- 实现策略模式，支持多种 ASR/TTS 服务切换
- 支持流式输出

### 修改：apps/api-server

```
apps/api-server/src/
├── speech/                        # 新增语音模块
│   ├── speech.module.ts
│   ├── speech.controller.ts       # ASR 端点
│   └── speech.service.ts          # 调用 speech-service
├── rag/
│   ├── rag.controller.ts          # 原有（不变）
│   ├── rag-tts.controller.ts      # 新增：流式 RAG+TTS 端点
│   └── ...
└── ...
```

### 不变：packages/ai-service

`ai-service` **不需要修改**，继续保持纯 LangChain RAG 逻辑。

## Risks / Trade-offs

### 风险

| 风险                   | 影响               | 缓解措施                          |
| ---------------------- | ------------------ | --------------------------------- |
| Edge-TTS 服务不可用    | TTS 功能失效       | 支持切换到 SiliconFlow/OpenRouter |
| 流式音频播放不连续     | 用户体验差         | 使用音频缓冲队列，预缓冲机制      |
| 浏览器音频 API 兼容性  | 部分浏览器无法播放 | 检测支持，降级到完整文件播放      |
| 网络延迟导致音画不同步 | 体验差             | 音频预缓冲 + 自适应码率           |

### 权衡

- **流式 vs 完整**：流式实现复杂，但用户体验更好
- **Edge-TTS vs API**：Edge-TTS 免费但依赖 Node.js 环境
- **SSE vs WebSocket**：SSE 更简单，但无法实现语音打断

## Migration Plan

### 部署步骤

1. 创建 `packages/speech-service` 包
2. 安装 `edge-tts` 依赖
3. 添加环境变量（.env）
4. 构建 speech-service 包
5. 构建 api-server（新增 speech module + 流式端点）
6. 构建 web-client（新增语音组件 + 流式播放器）
7. 重启所有服务

**注意**：ai-service 不需要修改，保持原样

### 回滚策略

- 语音功能为增量添加，不影响现有 RAG 查询流程
- 如需回滚，删除新增的环境变量，降级前端代码到纯文本版本
- 数据库无需迁移（语音功能不涉及数据库变更）

## Open Questions

1. **Edge-TTS 的延迟**？
   - 首次调用可能有冷启动延迟
   - 需要测试中文句子的 TTS 响应时间

2. **音频缓冲策略**？
   - 预缓冲多少秒的音频再开始播放？
   - 如何处理网络波动？

3. **TTS 文本预处理**？
   - 是否需要过滤 Markdown 格式？
   - 如何处理代码块？
