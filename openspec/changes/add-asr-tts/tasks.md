## 1. 配置与环境准备

- [x] 1.1 在 `.env.example` 添加 ASR/TTS 环境变量模板（TTS_PROVIDER, ASR_PROVIDER 等）
- [x] 1.2 更新 `apps/api-server/src/app.module.ts` 配置读取
- [x] 1.3 创建 `packages/speech-service/package.json` 包配置
- [x] 1.4 创建 `packages/speech-service/tsconfig.build.json`
- [x] 1.5 安装 `edge-tts` 依赖

## 2. 语音服务包 - packages/speech-service（新建）

- [x] 2.1 创建 `src/asr/asr.interface.ts` ASR 接口定义
- [x] 2.2 创建 `src/asr/siliconflow.asr.ts` SiliconFlow ASR 实现
- [x] 2.3 创建 `src/tts/tts.interface.ts` TTS 接口定义
- [x] 2.4 创建 `src/tts/edge.tts.ts` Edge-TTS 流式实现
- [x] 2.5 创建 `src/tts/siliconflow.tts.ts` SiliconFlow TTS 备选
- [x] 2.6 创建 `src/stream/text-splitter.ts` 文本分句工具
- [x] 2.7 创建 `src/stream/audio-buffer.ts` 音频流缓冲
- [x] 2.8 创建 `src/speech.config.ts` 配置接口
- [x] 2.9 创建 `src/speech.factory.ts` 服务工厂
- [x] 2.10 创建 `src/index.ts` 统一导出

## 3. 后端 API - 语音端点

- [x] 3.1 创建 `apps/api-server/src/speech/speech.module.ts` 模块定义
- [x] 3.2 创建 `apps/api-server/src/speech/speech.controller.ts` ASR 端点
- [x] 3.3 创建 `apps/api-server/src/speech/speech.controller.ts` 流式 TTS 端点
- [x] 3.4 创建 `apps/api-server/src/speech/speech.service.ts` 语音服务代理
- [x] 3.5 更新 `apps/api-server/src/app.module.ts` 导入 SpeechModule

## 4. 后端 - 流式 TTS + LLM 集成

- [x] 4.1 创建 `apps/api-server/src/rag/rag-tts.controller.ts` 流式 RAG+TTS 端点
- [x] 4.2 实现 LLM 文本流分句检测逻辑（。！？\n）
- [x] 4.3 实现文本句子到 TTS 的流式管道
- [x] 4.4 实现 SSE 音频流输出格式（Base64 编码的 MP3 chunk）
- [x] 4.5 实现并行处理：文本显示 + 音频生成

## 5. 前端 API 层

- [x] 5.1 创建 `apps/web-client/src/api/speech.ts` ASR 调用函数
- [x] 5.2 创建 `apps/web-client/src/api/speech.ts` 流式 TTS 调用函数
- [x] 5.3 创建 `apps/web-client/src/api/rag-tts.ts` 流式 RAG+TTS 调用
- [x] 5.4 更新 `apps/web-client/src/api/index.ts` 导出语音 API

## 6. 前端组件 - 语音输入

- [x] 6.1 创建 `apps/web-client/src/components/VoiceInput.tsx` 录音按钮组件
- [x] 6.2 实现 MediaRecorder 录音逻辑（WebM/Opus 格式）
- [x] 6.3 实现录音状态 UI（红色圆点 + 时长显示）
- [x] 6.4 实现麦克风权限请求和错误处理
- [x] 6.5 实现 60 秒录音时长限制

## 7. 前端组件 - 流式音频播放器

- [x] 7.1 创建 `apps/web-client/src/components/StreamAudioPlayer.tsx` 流式播放器
- [x] 7.2 实现 AudioContext 流式播放逻辑（MP3 chunk）
- [x] 7.3 实现音频播放队列（确保连续性）
- [x] 7.4 实现预缓冲机制（缓冲 2 个 chunk 后播放）
- [x] 7.5 实现播放/暂停/停止状态切换
- [x] 7.6 实现播放状态指示（正在朗读、缓冲中、完成）

## 8. 前端 - TTS 开关控制

- [x] 8.1 在 Chat.tsx 添加 TTS 开关按钮
- [x] 8.2 实现 TTS 开关状态持久化（localStorage）
- [x] 8.3 实现 TTS 关闭时仅显示文本

## 9. 集成与测试

- [x] 9.1 修改 `apps/web-client/src/components/Chat.tsx` 集成 VoiceInput
- [x] 9.2 修改 `apps/web-client/src/components/Chat.tsx` 集成 StreamAudioPlayer
- [x] 9.3 实现 ASR 识别后自动提交查询流程
- [ ] 9.4 测试 ASR 完整流程（录音 → 上传 → 识别 → 查询）
- [ ] 9.5 测试流式 TTS 完整流程（LLM 输出 → 分句 → TTS → 播放）
- [ ] 9.6 测试音频播放连续性（无断续）

## 10. 错误处理与降级

- [x] 10.1 实现 ASR 错误提示（网络错误、配额不足、识别失败）
- [x] 10.2 实现 TTS 错误处理（跳过句子，仅显示文本）
- [x] 10.3 实现麦克风权限被拒绝的降级处理
- [x] 10.4 实现文本过长截取提示（ASR > 500 字符）
- [x] 10.5 实现 TTS 服务不可用时的降级（纯文本模式）

## 11. 文档更新

- [x] 11.1 更新 `README.md` 添加语音功能说明
- [x] 11.2 更新 `.env.example` 添加 ASR/TTS 配置说明
- [x] 11.3 更新 Swagger API 文档（语音端点描述）
