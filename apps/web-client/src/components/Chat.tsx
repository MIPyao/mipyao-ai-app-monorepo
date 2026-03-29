"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "./ChatMessage";
import { WelcomeScreen } from "./WelcomeScreen";
import { VoiceInput } from "./VoiceInput";
import { StreamAudioPlayer, StreamAudioPlayerRef } from "./StreamAudioPlayer";
import {
  streamRagQuery,
  streamRagTtsQuery,
  recognizeSpeech,
} from "@/api/index";
import { Send, RefreshCw, Eraser, Volume2, VolumeX } from "lucide-react";
import { Message } from "@/types";

// 用于解码服务器返回的 Uint8Array 数据块
const decoder = new TextDecoder("utf-8");

// TTS 开关的 localStorage key
const TTS_ENABLED_KEY = "tts-enabled";

/**
 * Renders the chat user interface for RAG-based conversations with optional voice input and text-to-speech playback.
 *
 * The component manages message state, streaming queries (RAG with or without TTS), voice recognition, an audio stream player, TTS toggle persisted to localStorage, optimistic UI updates for user/assistant messages, auto-scrolling, and controls for clearing the conversation.
 *
 * @returns The chat UI as a JSX element.
 */
export function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioPlayerRef = useRef<StreamAudioPlayerRef>(null);

  // TTS 开关状态 - 初始值固定为 false，避免 hydration 错误
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // 客户端挂载后从 localStorage 读取 TTS 状态
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(TTS_ENABLED_KEY);
    if (saved === "true") {
      setTtsEnabled(true);
    }
  }, []);

  // 当 TTS 关闭时停止播放器（useEffect 避免渲染期间状态更新）
  useEffect(() => {
    if (!ttsEnabled && audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
  }, [ttsEnabled]);

  // 将 TTS 状态保存到 localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(TTS_ENABLED_KEY, String(ttsEnabled));
    }
  }, [ttsEnabled]);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => !prev);
  }, []);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 处理语音识别完成
  const handleVoiceInput = async (audioBlob: Blob) => {
    if (isLoading) return;

    setIsRecognizing(true);
    try {
      const text = await recognizeSpeech(audioBlob);
      if (text.trim()) {
        // 识别成功，自动提交查询
        await handleSubmit(undefined, text);
      }
    } catch (error) {
      console.error("语音识别失败:", error);
      const errorMessage = "语音识别失败，请重试或使用文字输入。";
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: errorMessage,
          isError: true,
        },
      ]);
    } finally {
      setIsRecognizing(false);
    }
  };

  // 使用流式 RAG+TTS 查询
  const handleSubmitWithTts = async (userInput: string) => {
    // 清理之前的播放器状态（避免第二次播放时卡住）
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }

    const userMsgId = Date.now().toString();
    const aiMsgId = (Date.now() + 1).toString();

    // 乐观更新 UI
    const userMessage: Message = {
      id: userMsgId,
      role: "user",
      content: userInput,
    };
    const initialAiMessage: Message = {
      id: aiMsgId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMessage, initialAiMessage]);

    // 使用 SSE 流式 RAG+TTS
    const cancel = streamRagTtsQuery(userInput, (event) => {
      switch (event.event) {
        case "text":
          // 更新文本内容
          if (event.data.content) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId
                  ? { ...msg, content: msg.content + event.data.content }
                  : msg,
              ),
            );
          }
          break;

        case "audio":
          // 添加音频 chunk 到播放器
          if (event.data.content && audioPlayerRef.current) {
            audioPlayerRef.current.addChunk(event.data.content);
          }
          break;

        case "error":
          console.error("RAG-TTS 错误:", event.data.message);
          // TTS 错误不影响文本显示
          if (event.data.type === "rag" || event.data.type === "init") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId
                  ? {
                      ...msg,
                      content: msg.content || event.data.message || "发生错误",
                      isError: true,
                    }
                  : msg,
              ),
            );
          }
          break;

        case "done":
          // 结束音频流
          if (audioPlayerRef.current) {
            audioPlayerRef.current.endStream();
          }
          setIsLoading(false);
          setTimeout(() => inputRef.current?.focus(), 100);
          break;
      }
    });

    // 返回取消函数（用于组件卸载时清理）
    return cancel;
  };

  // 使用普通 RAG 流（无 TTS）
  const handleSubmitWithoutTts = async (userInput: string) => {
    const userMsgId = Date.now().toString();
    const aiMsgId = (Date.now() + 1).toString();

    const userMessage: Message = {
      id: userMsgId,
      role: "user",
      content: userInput,
    };
    const initialAiMessage: Message = {
      id: aiMsgId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMessage, initialAiMessage]);

    try {
      const response = await streamRagQuery(userInput);

      if (!response.ok || !response.body) {
        throw new Error(`API error: ${response.statusText} 或响应体为空`);
      }

      const reader = response.body.getReader();
      let done = false;
      let accumulatedContent = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          accumulatedContent += chunk;

          setMessages((prevMessages) =>
            prevMessages.map((msg) =>
              msg.id === aiMsgId
                ? { ...msg, content: accumulatedContent }
                : msg,
            ),
          );
        }
      }
    } catch (error) {
      console.error("API 流式调用失败:", error);
      const errorMessage =
        "抱歉，处理请求时出现流式错误。请检查 Nest.js 后端是否运行端口。";

      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, content: errorMessage, isError: true }
            : msg,
        ),
      );
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSubmit = async (e?: React.FormEvent, overrideInput?: string) => {
    e?.preventDefault();

    const userInput = overrideInput || input;

    if (!userInput.trim() || isLoading) return;

    setInput("");
    setIsLoading(true);

    // 根据 TTS 开关选择不同的查询方式
    if (ttsEnabled) {
      await handleSubmitWithTts(userInput);
    } else {
      await handleSubmitWithoutTts(userInput);
    }
  };

  const handleClearChat = () => {
    if (window.confirm("确定要清空所有对话吗？")) {
      setMessages([]);
      // 停止音频播放器
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop();
      }
    }
  };

  return (
    <div className="flex flex-col w-full h-screen relative font-sans text-slate-900">
      {/* 细微的背景点阵纹理 */}
      <div
        className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(#475569 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      ></div>

      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur-md border-b border-gray-200/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            RAG
          </div>
          <div>
            <h1 className="font-semibold text-slate-800">简历助手</h1>
            <p className="text-xs text-slate-500">
              Retrieval Augmented Generation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* TTS 开关 */}
          <button
            onClick={toggleTts}
            className={`p-2 rounded-lg transition-colors ${
              ttsEnabled
                ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            }`}
            title={ttsEnabled ? "关闭语音朗读" : "开启语音朗读"}
          >
            {ttsEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>

          {/* 流式音频播放器（无 UI，仅功能组件） */}
          {ttsEnabled && (
            <StreamAudioPlayer
              ref={audioPlayerRef}
              autoPlay={true}
              minBufferChunks={1}
            />
          )}

          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="清空对话"
            >
              <Eraser size={18} />
            </button>
          )}
        </div>
      </header>

      {/* 消息列表区域 */}
      <div className="flex-1 overflow-y-auto z-0 relative scroll-smooth">
        <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col justify-center pb-20">
              <WelcomeScreen
                onSuggestionClick={(text) => handleSubmit(undefined, text)}
              />
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* 流式音频播放器（右上角控制，这里不显示） */}
      {/* 播放器控制通过右上角的 TTS 开关进行 */}

      {/* 底部输入框区域 */}
      <div className="z-20 p-4 pb-6 bg-linear-to-t from-slate-50 via-slate-50 to-transparent">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={(e) => handleSubmit(e)}
            className={`relative flex items-center gap-2 bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-gray-200 p-2 transition-all duration-200 ${
              isLoading
                ? "opacity-90 grayscale-[0.5]"
                : "hover:border-indigo-300 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100"
            }`}
          >
            {/* 语音输入按钮 */}
            <VoiceInput
              onRecordingComplete={handleVoiceInput}
              disabled={isLoading || isRecognizing}
            />

            <input
              ref={inputRef}
              className="flex-1 max-h-32 min-h-[50px] px-4 py-2 bg-transparent text-slate-700 placeholder:text-slate-400 focus:outline-none resize-none"
              value={input}
              placeholder={
                isRecognizing
                  ? "正在识别语音..."
                  : isLoading
                    ? "AI 正在思考中..."
                    : "问一个关于赵耀简历的问题..."
              }
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading || isRecognizing}
              autoComplete="off"
            />

            <button
              type="submit"
              disabled={!input.trim() || isLoading || isRecognizing}
              className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 ${
                !input.trim() || isLoading || isRecognizing
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:scale-105 active:scale-95"
              }`}
            >
              {isLoading ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5 ml-0.5" />
              )}
            </button>
          </form>
          <div className="text-center mt-3">
            <p className="text-xs text-slate-400">
              AI 内容由大模型生成，请仔细甄别。
              {ttsEnabled && " • 语音朗读已开启"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
