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

const decoder = new TextDecoder("utf-8");
const TTS_ENABLED_KEY = "tts-enabled";

export function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioPlayerRef = useRef<StreamAudioPlayerRef>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const [ttsEnabled, setTtsEnabled] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(TTS_ENABLED_KEY);
    if (saved === "true") {
      setTtsEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!ttsEnabled && audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
  }, [ttsEnabled]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(TTS_ENABLED_KEY, String(ttsEnabled));
    }
  }, [ttsEnabled]);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => !prev);
  }, []);

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      cancelRef.current?.();
    };
  }, []);

  const handleVoiceInput = async (audioBlob: Blob) => {
    if (isLoading) return;

    setIsRecognizing(true);
    try {
      const text = await recognizeSpeech(audioBlob);
      if (text.trim()) {
        await handleSubmit(undefined, text);
      }
    } catch (error) {
      console.error("语音识别失败:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: "语音识别失败，请重试或使用文字输入。",
          isError: true,
        },
      ]);
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleSubmitWithTts = async (userInput: string) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }

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

    const cancel = streamRagTtsQuery(userInput, (event) => {
      switch (event.event) {
        case "text":
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
          if (event.data.content && audioPlayerRef.current) {
            audioPlayerRef.current.addChunk(event.data.content);
          }
          break;

        case "error":
          console.error("RAG-TTS 错误:", event.data.message);
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
          if (audioPlayerRef.current) {
            audioPlayerRef.current.endStream();
          }
          setIsLoading(false);
          setTimeout(() => inputRef.current?.focus(), 100);
          break;
      }
    });

    return cancel;
  };

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
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, content: "抱歉，处理请求时出现流式错误。请检查后端是否运行。", isError: true }
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

    if (ttsEnabled) {
      cancelRef.current = await handleSubmitWithTts(userInput);
    } else {
      await handleSubmitWithoutTts(userInput);
    }
  };

  const handleClearChat = () => {
    if (window.confirm("确定要清空所有对话吗？")) {
      setMessages([]);
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop();
      }
    }
  };

  return (
    <div className="flex flex-col w-full h-screen relative font-sans text-text-primary">
      {/* 细微背景纹理 */}
      <div
        className="absolute inset-0 z-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(var(--color-text-primary) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      ></div>

      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-surface/80 backdrop-blur-md border-b border-border-light">
        <div className="flex items-center gap-3">
          <div className="w-10 h-8 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-sm font-heading tracking-tight">
            RAG
          </div>
          <div>
            <h1 className="font-heading font-semibold text-text-primary text-base leading-tight">
              简历助手
            </h1>
            <p className="text-xs text-text-muted font-sans">
              Retrieval Augmented Generation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTts}
            className={`p-2 rounded-lg transition-all duration-200 ${
              ttsEnabled
                ? "text-primary-600 bg-primary-50 hover:bg-primary-100"
                : "text-text-muted hover:text-text-secondary hover:bg-bg"
            }`}
            title={ttsEnabled ? "关闭语音朗读" : "开启语音朗读"}
          >
            {ttsEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>

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
              className="p-2 text-text-muted hover:text-error hover:bg-error-light rounded-lg transition-all duration-200"
              title="清空对话"
            >
              <Eraser size={18} />
            </button>
          )}
        </div>
      </header>

      {/* 消息列表区域 */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto z-0 relative scroll-smooth bg-bg">
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

      {/* 底部输入框区域 */}
      <div className="z-20 p-4 pb-6 bg-bg">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={(e) => handleSubmit(e)}
            className={`relative flex items-center gap-2 bg-surface rounded-xl shadow-md border border-border transition-all duration-200 ${
              isLoading
                ? "opacity-90 grayscale-[0.5]"
                : "hover:border-primary-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary-50"
            }`}
          >
            <VoiceInput
              onRecordingComplete={handleVoiceInput}
              disabled={isLoading || isRecognizing}
            />

            <input
              ref={inputRef}
              className="flex-1 max-h-32 min-h-[50px] px-4 py-2 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none resize-none font-sans"
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
              className={`p-3 rounded-lg flex items-center justify-center transition-all duration-200 ${
                !input.trim() || isLoading || isRecognizing
                  ? "bg-bg text-text-muted cursor-not-allowed"
                  : "bg-primary text-white shadow-sm shadow-primary/20 hover:bg-primary-600 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
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
            <p className="text-xs text-text-muted font-sans">
              AI 内容由大模型生成，请仔细甄别。
              {ttsEnabled && " • 语音朗读已开启"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
