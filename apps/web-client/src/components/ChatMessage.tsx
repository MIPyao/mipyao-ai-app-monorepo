import React from "react";
import { Message } from "@/types/index";
import { User, Bot, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`group flex w-full ${
        isUser ? "justify-end" : "justify-start"
      } mb-6`}
    >
      <div
        className={`flex max-w-[85%] md:max-w-[75%] lg:max-w-[70%] gap-3 ${
          isUser ? "flex-row-reverse" : "flex-row"
        }`}
      >
        {/* 头像 */}
        <div
          className={`shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center shadow-sm border ${
            isUser
              ? "bg-indigo-100 border-indigo-200"
              : "bg-white border-gray-200"
          }`}
        >
          {isUser ? (
            <User className="w-5 h-5 text-indigo-600" />
          ) : (
            <Bot className="w-5 h-5 text-emerald-600" />
          )}
        </div>

        {/* 气泡 */}
        <div
          className={`relative px-5 py-3.5 shadow-sm text-sm md:text-base leading-relaxed ${
            isUser
              ? "bg-linear-to-br from-indigo-600 to-blue-600 text-white rounded-2xl rounded-tr-sm"
              : "bg-white border border-gray-100 text-slate-800 rounded-2xl rounded-tl-sm"
          }`}
        >
          {/* 内容 */}
          <div className="font-normal tracking-wide prose prose-sm max-w-none">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                // 核心渲染内容
                // 使用 components 属性可以定制 Markdown 渲染的 HTML 元素样式
                components={{
                  // 示例：定制列表样式 (可选)
                  ul: ({ node: _node, ...props }) => (
                    <ul className="list-disc pl-5 my-2" {...props} />
                  ),
                  ol: ({ node: _node, ...props }) => (
                    <ol className="list-decimal pl-5 my-2" {...props} />
                  ),
                  // 示例：定制段落样式 (可选)
                  p: ({ node: _node, ...props }) => (
                    <p className="mb-2 last:mb-0" {...props} />
                  ),
                  // 更多定制，如 h1, h2, pre/code 等
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              // 处理空内容时的闪烁光标效果
              !isUser && (
                <span className="inline-block w-2 h-4 align-middle bg-slate-400 animate-pulse ml-1"></span>
              )
            )}
          </div>

          {/* 操作按钮 (仅 AI 消息显示) */}
          {!isUser && (
            <div className="absolute -bottom-6 left-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-2 pt-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                title="复制内容"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
