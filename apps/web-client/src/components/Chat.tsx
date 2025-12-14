"use client";

import { useState, useRef, useEffect } from "react";
import { ChatMessage } from "./ChatMessage";
import { WelcomeScreen } from "./WelcomeScreen";
import { streamRagQuery } from "@/api/index";
import { Send, RefreshCw, Eraser } from "lucide-react";
import { Message } from "@/types"; // 建议使用统一的类型定义

// 用于解码服务器返回的 Uint8Array 数据块
const decoder = new TextDecoder("utf-8");

export function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent, overrideInput?: string) => {
    e?.preventDefault();

    const userInput = overrideInput || input;

    if (!userInput.trim() || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsgId = Date.now().toString();
    const aiMsgId = (Date.now() + 1).toString();

    // 1. 乐观更新 UI
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

  const handleClearChat = () => {
    if (window.confirm("确定要清空所有对话吗？")) {
      setMessages([]);
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
            <input
              ref={inputRef}
              className="flex-1 max-h-32 min-h-[50px] px-4 py-2 bg-transparent text-slate-700 placeholder:text-slate-400 focus:outline-none resize-none"
              value={input}
              placeholder={
                isLoading ? "AI 正在思考中..." : "问一个关于赵耀简历的问题..."
              }
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              autoComplete="off"
            />

            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={`p-3 rounded-xl flex items-center justify-center transition-all duration-200 ${
                !input.trim() || isLoading
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
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
