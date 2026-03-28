/**
 * @mipyao/speech-service
 * 语音服务包 - 提供 ASR (语音识别) 和 TTS (语音合成功能)
 *
 * 设计原则：三明治架构
 * - speech-service 独立处理音频，不依赖 LangChain
 * - ai-service 专注 RAG/Agent，只处理文本
 * - api-server 作为协调层
 */

// 配置
export { SpeechConfig, loadSpeechConfig } from "./speech.config";

// ASR
export { IAsrService, AsrConfig, AsrResult } from "./asr/asr.interface";
export { SiliconFlowAsrService } from "./asr/siliconflow.asr";

// TTS
export { ITtsService, TtsConfig, TtsStreamChunk } from "./tts/tts.interface";
export { SiliconFlowTtsService } from "./tts/siliconflow.tts";

// Stream 工具
export { TextSplitter, Sentence } from "./stream/text-splitter";
export { AudioStreamBuffer, AudioBufferOptions } from "./stream/audio-buffer";

// 工厂
export { SpeechServiceFactory } from "./speech.factory";
