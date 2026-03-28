## Why

当前 MIPYao 简历助手仅支持文本输入/输出交互方式。为了提升用户体验和系统可访问性，需要增加语音交互能力：用户可以通过语音提问（ASR），系统可以通过语音实时朗读回答（流式 TTS）。这将使系统更加自然、便捷，特别是在移动设备或不方便打字的场景下。

## What Changes

- **新增语音识别（ASR）功能**：用户可以点击麦克风按钮录制语音，系统自动将其转换为文本并提交查询
- **新增流式语音合成（TTS）功能**：LLM 生成回答时，边输出文本边转换为语音实时朗读，无需等待回答完成
- **前端新增语音交互组件**：录音按钮、录音状态指示器、实时语音播放控制
- **后端新增语音服务端点**：`POST /speech/asr` 和流式 TTS 端点
- **AI 服务层新增语音服务模块**：封装 ASR/TTS API 调用逻辑

## Capabilities

### New Capabilities

- `speech-recognition`: 语音识别功能，将用户语音转换为文本。涵盖：音频录制、音频上传、ASR API 调用、结果返回
- `speech-synthesis`: 流式语音合成功能，将 LLM 输出的文本流实时转换为语音流。涵盖：文本流处理、流式 TTS API 调用、音频流返回、前端实时播放

### Modified Capabilities

- `rag-query`: 需要支持接收 ASR 识别后的文本作为查询输入，以及支持流式 TTS 输出（无需修改核心逻辑，仅前端调用链路调整）

## Impact

### 前端（apps/web-client）

- 新增 `VoiceInput` 组件：录音按钮 + 录音状态 UI
- 新增 `StreamAudioPlayer` 组件：流式音频播放控制（支持边下边播）
- 修改 `Chat.tsx`：集成语音输入和流式播放功能
- 新增 `speech.ts` API 模块：调用后端语音端点
- 依赖变化：可能需要 Web Audio API polyfill（现代浏览器原生支持）

### 后端（apps/api-server）

- 新增 `SpeechModule`：语音服务模块
- 新增 `SpeechController`：ASR 端点 + 流式 TTS 端点
- 新增 `SpeechService`：调用 AI 服务层的语音功能

### AI 服务（packages/ai-service）

- **无需修改**，保持纯 LangChain RAG 逻辑
- 不引入语音相关代码

### 语音服务（packages/speech-service）- 新建

- 新建独立 npm 包，专注 ASR/TTS
- `src/asr/`：ASR 功能（SiliconFlow）
- `src/tts/`：TTS 功能（Edge-TTS、SiliconFlow、OpenRouter）
- `src/stream/`：流式处理工具
- 不依赖 LangChain，纯音频处理

### 配置

- 新增环境变量：
  - `ASR_PROVIDER` - ASR 服务提供商（siliconflow / openrouter / local）
  - `ASR_MODEL` - ASR 模型名称
  - `TTS_PROVIDER` - TTS 服务提供商（siliconflow / openrouter / edge-tts / local）
  - `TTS_MODEL` - TTS 模型名称（如适用）
  - `TTS_VOICE` - TTS 音色（可选）

### 技术选型建议

**ASR 服务**（按优先级）：

1. **SiliconFlow** - 项目已在使用，复用 API Key，免费额度
2. **OpenRouter** - 同样已有 API Key，部分模型支持 ASR

**TTS 服务**（按优先级）：

1. **Edge-TTS**（微软）- 完全免费，支持流式，中文音质好，无需 API Key
2. **SiliconFlow TTS** - 复用现有 API Key，支持流式
3. **Hugging Face ONNX 本地模型** - 完全免费，无网络延迟，但需要本地运行推理

**推荐组合**：SiliconFlow ASR + Edge-TTS（免费 + 流式 + 效果好）
