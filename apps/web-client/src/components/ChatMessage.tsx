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
          className={`shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center shadow-sm border transition-colors ${
            isUser
              ? "bg-primary-100 border-primary-200"
              : "bg-surface border-border"
          }`}
        >
          {isUser ? (
            <User className="w-5 h-5 text-primary-600" />
          ) : (
            <Bot className="w-5 h-5 text-accent" />
          )}
        </div>

        {/* 气泡 */}
        <div
          className={`relative px-5 py-3.5 shadow-sm text-sm md:text-base leading-relaxed transition-shadow hover:shadow-md ${
            isUser
              ? "bg-primary text-white rounded-2xl rounded-tr-sm"
              : message.isError
                ? "bg-error-light border border-error/20 text-text-primary rounded-2xl rounded-tl-sm"
                : "bg-surface border border-border text-text-primary rounded-2xl rounded-tl-sm"
          }`}
        >
          {/* 内容 */}
          <div className="font-normal tracking-wide prose prose-sm max-w-none prose-p:text-inherit prose-headings:text-inherit prose-strong:text-inherit prose-a:text-primary-600">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ul: ({ node: _node, ...props }) => (
                    <ul className="list-disc pl-5 my-2" {...props} />
                  ),
                  ol: ({ node: _node, ...props }) => (
                    <ol className="list-decimal pl-5 my-2" {...props} />
                  ),
                  p: ({ node: _node, ...props }) => (
                    <p className="mb-2 last:mb-0" {...props} />
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              !isUser && (
                <span className="inline-block w-2 h-4 align-middle bg-text-muted/40 animate-pulse ml-1"></span>
              )
            )}
          </div>

          {/* 操作按钮 */}
          {!isUser && !message.isError && (
            <div className="absolute -bottom-6 left-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-2 pt-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
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
