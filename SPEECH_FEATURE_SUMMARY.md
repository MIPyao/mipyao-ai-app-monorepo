# RAG 简历助手 - 语音功能技术总结

## 📋 目录

1. [功能概述](#功能概述)
2. [架构设计](#架构设计)
3. [技术路线](#技术路线)
4. [核心实现](#核心实现)
5. [关键问题与解决方案](#关键问题与解决方案)
6. [未来优化方向](#未来优化方向)

---

## 功能概述

为现有的 RAG 简历问答系统添加完整的语音交互能力：

- **ASR (语音识别)**：用户可以通过麦克风录制语音，系统识别为文本后自动提交查询
- **TTS (语音合成)**：AI 回答自动转换为语音并播放，支持**流式边生成边朗读**

关键特性：

- ✅ 前端直接录制 WAV 格式（避免格式转换错误）
- ✅ 流式音频播放队列（FIFO 顺序）
- ✅ 解码进度跟踪和超时保护
- ✅ Markdown 内容优化（列表符号转换）
- ✅ 可靠的错误降级处理

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Web Client                         │
│                   Next.js (端口 3001)                    │
│   ┌───────────────┐  ┌───────────────┐  ┌────────────┐ │
│   │   VoiceInput  │  │ ChatMessage   │  │ StreamAudio│ │
│   │   (语音输入)   │  │   (消息展示)   │  │  Player    │ │
│   └───────────────┘  └───────────────┘  └────────────┘ │
└────────────────────────┬────────────────────────────────┘
                          │ HTTP/SSE
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      API Server                         │
│                  NestJS (端口 3000)                      │
│   ┌───────────────┐  ┌───────────────┐  ┌────────────┐ │
│   │ RagController │  │SpeechController│ │RagTtsCtrl  │ │
│   │   /rag/stream │  │  /speech/*     │ │/rag-tts/*  │ │
│   └───────┬───────┘  └───────┬───────┘  └─────┬──────┘ │
└───────────┼──────────────────┼────────────────┼────────┘
            │                  │                │
    ┌───────▼───────┐  ┌──────▼──────┐  ┌──────▼──────┐
    │  AI Service   │  │   Speech    │  │    Both     │
    │  (LangChain)  │  │   Service   │  │             │
    └───────┬───────┘  └──────┬───────┘  └─────────────┘
            │                 │
     ┌──────┴──────┐    ┌─────┴─────┐
     ▼             ▼    ▼           ▼
┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐
│OpenRouter│ │PostgreSQL│ │Silicon- │ │Silicon- │
│  (LLM)  │ │ pgvector │ │  Flow   │ │  Flow   │
└─────────┘ └──────────┘ │  ASR    │ │  TTS    │
                          │ + TTS   │ │(CosyVoice│
                          └─────────┘ │2-0.5B)  │
                                      └─────────┘
                              ┌──────────────────┐
                              │  统一语音平台     │
                              │  Speech Service  │
                              └──────────────────┘
```

### 三明治架构 (Sandwich Architecture)

```
用户语音 → ASR → LangChain (RAG) → TTS → 语音输出
              ↑                        ↑
         Speech Service           Speech Service
```

**核心原则**：

- **AI Service (LangChain)**: 只处理文本，专注 RAG 检索和生成
- **Speech Service**: 独立处理音频，不依赖 LangChain
- **API Server**: 作为协调层，编排语音和 AI 的调用顺序

---

## 技术路线

### 1. 技术选型

| 功能         | 方案                          | 理由                                   |
| ------------ | ----------------------------- | -------------------------------------- |
| ASR 语音识别 | SiliconFlow (SenseVoiceSmall) | 免费、中文识别准确率高、支持流式       |
| TTS 语音合成 | SiliconFlow (CosyVoice2-0.5B) | 免费、音质自然、支持流式               |
| 前端录音     | Web Audio API + WAV 编码      | 避免浏览器默认 WebM 格式，兼容 ASR API |
| 流式传输     | Server-Sent Events (SSE)      | 简单高效，支持文本和音频混合流         |
| 音频播放     | Web Audio API + Queue         | 精确控制播放顺序，支持队列管理         |

### 2. 包结构

```
packages/
├── speech-service/           # 语音服务包
│   ├── src/
│   │   ├── asr/
│   │   │   ├── asr.interface.ts
│   │   │   └── siliconflow.asr.ts
│   │   ├── tts/
│   │   │   ├── tts.interface.ts
│   │   │   └── siliconflow.tts.ts
│   │   ├── stream/
│   │   │   ├── text-splitter.ts    # 句子分割
│   │   │   └── audio-buffer.ts     # 音频缓冲管理
│   │   ├── speech.config.ts
│   │   ├── speech.factory.ts
│   │   └── index.ts
│   └── package.json
│
apps/
├── api-server/
│   └── src/
│       ├── rag/
│       │   └── rag-tts.controller.ts  # 流式 RAG+TTS 控制器
│       └── speech/
│           └── speech.service.ts      # 语音服务代理
│
└── web-client/
    └── src/
        ├── components/
        │   ├── VoiceInput.tsx          # 语音输入组件
        │   ├── StreamAudioPlayer.tsx   # 流式音频播放器
        │   └── Chat.tsx                # 主聊天组件（集成 TTS）
        └── api/
            ├── speech.ts               # 语音 API
            └── rag-tts.ts              # RAG+TTS API
```

---

## 核心实现

### 1. 前端音频录制 (VoiceInput.tsx)

**关键问题**：浏览器 `MediaRecorder` 默认生成 WebM 格式，但 SiliconFlow ASR 只支持 WAV/MP3。

**解决方案**：使用 AudioContext 手动录制并编码为 WAV。

```typescript
// 核心逻辑
const startRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];

  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const webmBlob = new Blob(chunks, { type: "audio/webm" });

    // 转换为 WAV
    const wavBlob = await convertWebMToWav(webmBlob);
    onRecordingComplete(wavBlob);
  };

  mediaRecorder.start();
  // 存储 stream 和 recorder 用于停止
};
```

**WAV 转换**：

- 读取 WebM 音频数据
- 使用 AudioContext 解码为 PCM
- 重新编码为 WAV 格式（RIFF 头部 + PCM 数据）
- 关键：采样率必须与 `MediaStream` 的实际采样率一致

### 2. 流式音频播放器 (StreamAudioPlayer.tsx)

**核心挑战**：音频流是 `data` 事件触发，顺序不能保证；需要队列管理和状态跟踪。

**数据结构**：

```typescript
interface PlayerState {
  audioQueue: AudioBuffer[]; // 待播放队列（FIFO）
  isPlaying: boolean; // 是否正在播放
  pendingDecodeCount: number; // 正在解码的 chunk 数量
  isStreamEnded: boolean; // 流是否已结束
}
```

**播放流程**：

1. `addChunk(uint8Array)` - 接收音频数据块
2. 解码为 AudioBuffer（异步）
3. 加入 `audioQueue`
4. 如果空闲，开始播放队列
5. `playNext()` - 播放完成后自动播放下一个
6. `endStream()` - 标记流结束，等待所有解码完成

**关键保护机制**：

- 🛡️ **超时保护**：长音频 `onended` 事件可能不触发，使用 `setTimeout` 强制播放下一个
- 🛡️ **状态管理**：`currentSourceRef` 跟踪当前播放源，避免重复停止
- 🛡️ **解码等待**：`pendingDecodeCount` 跟踪解码进度，流结束后轮询等待

### 3. 后端流式 RAG+TTS (rag-tts.controller.ts)

**串行化处理**：TTS 请求必须按句子顺序执行，避免并发修改 `textBuffer`。

```typescript
// 使用队列串行化处理
let ttsQueue: Promise<void> = Promise.resolve();

const sentence = extractSentence(textBuffer, remainder);
const chunkAudio = (ttsQueue = ttsQueue.then(() =>
  speechService.tts(sentence, voice, { format: "wav" }),
));

// 通过事件发送音频
eventStream.send({
  event: "audio",
  data: { content: chunkAudio },
});
```

**Markdown 清理**：

- 列表符号 `-` 转换为中文顿号 `、`
- 避免 TTS 读成 "减"
- 保留其他 Markdown 格式（由前端渲染）

```typescript
function cleanMarkdownForTTS(text: string): string {
  return text.replace(/^[-*]\s/gm, "、").trim();
}
```

### 4. Chat 组件集成

**状态管理**：

```typescript
const [ttsEnabled, setTtsEnabled] = useState(false);
const audioPlayerRef = useRef<StreamAudioPlayerRef>(null);

// TTS 关闭时停止播放（useEffect 避免渲染期状态更新）
useEffect(() => {
  if (!ttsEnabled && audioPlayerRef.current) {
    audioPlayerRef.current.stop();
  }
}, [ttsEnabled]);

// 持久化
useEffect(() => {
  localStorage.setItem(TTS_ENABLED_KEY, String(ttsEnabled));
}, [ttsEnabled]);
```

**流式处理**：

- 开启 TTS：调用 `streamRagTtsQuery()`，同时处理 `text` 和 `audio` 事件
- 关闭 TTS：调用 `streamRagQuery()`，仅处理文本
- 新查询前调用 `stop()` 清理上一轮状态

---

## 关键问题与解决方案

| #   | 问题                          | 根因                                                  | 解决方案                                                |
| --- | ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| 1   | SiliconFlow ASR 返回 500 错误 | 前端发送 WebM 格式，API 只支持 WAV/MP3                | 前端手动编码为 WAV，采样率与 MediaStream 一致           |
| 2   | Edge-TTS 403 Forbidden        | 微软 Azure 服务在中国大陆被墙                         | 删除 edge-tts，全部切换到 SiliconFlow TTS               |
| 3   | 音频播放卡住                  | 长音频 `onended` 事件可能不触发                       | 添加超时保护 + `currentSourceRef` 状态管理              |
| 4   | 重复播放句子                  | `extractSentences` 每次处理整个 `textBuffer`          | Set 记录已处理句子 + 保留 `remainder`                   |
| 5   | 关闭 TTS 时报 React 错误      | `toggleTts` 在渲染期调用 `stop()` 触发 setState       | 将 `stop()` 移到 `useEffect` 中，监听 `ttsEnabled` 变化 |
| 6   | TTS 按钮位置跳动              | 播放器包裹层 `ml-2` 占位                              | 移除包裹层，直接渲染无 UI 播放器                        |
| 7   | VSCode Buffer 类型错误        | `speech-service` 缺少 `tsconfig.json` 和 `types` 配置 | 创建 `tsconfig.json`，添加 `"types": ["node"]`          |

---

## 未来优化方向

### 1. 用户体验

- [ ] TTS 播放速度调节
- [ ] 音色选择（支持 SiliconFlow 多个音色）
- [ ] 播放进度条显示
- [ ] 暂停/恢复功能
- [ ] 音量控制

### 2. 性能优化

- [ ] 音频预缓冲（提前解码下一句）
- [ ] 流式解码优化（Web Worker）
- [ ] 内存管理（播放完成后释放 AudioBuffer）

### 3. 可靠性

- [ ] 网络断开重连机制
- [ ] TTS 失败自动降级（只显示文本）
- [ ] 音频播放异常监控
- [ ] 自动重试机制

### 4. 扩展功能

- [ ] 多语言支持（ASR/TTS 多语言切换）
- [ ] 语音自定义（用户录音训练）
- [ ] 对话历史语音导出
- [ ] 实时语音对话模式（类似 ChatGPT 语音对话）

---

## 测试建议

### 手动测试清单

- [ ] 录音后正确识别为文本
- [ ] TTS 开启后能正常播放语音
- [ ] 长时间音频不会卡住
- [ ] 切换 TTS 开关无错误
- [ ] 快速切换 TTS 开关，按钮位置稳定
- [ ] 流结束时自动清理状态
- [ ] 列表符号正确转换（不读"减"）
- [ ] 新查询开始前停止上一轮播放

### 自动化测试

- [ ] 单元测试：`text-splitter.ts` 句子分割逻辑
- [ ] 单元测试：`audio-buffer.ts` 音频缓冲管理
- [ ] 集成测试：完整 RAG+TTS 流
- [ ] E2E 测试：前端录音→识别→问答→播放全流程

---

## 参考资料

- [SiliconFlow API 文档](https://docs.siliconflow.cn/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [WAV 文件格式](https://en.wikipedia.org/wiki/WAV)

---

**文档版本**: v1.0  
**最后更新**: 2026年3月  
**维护者**: MIPyao Team
