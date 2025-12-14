import { Chat } from "@/components/Chat";
import { Metadata } from "next";

// ✅ 服务端组件优势：可以定义静态或动态的 Metadata，对 SEO 非常友好
export const metadata: Metadata = {
  title: "AI 简历助手 | RAG Chat",
  description:
    "基于 RAG 技术的智能简历问答助手，快速了解赵耀的专业技能与项目经验。",
};

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-50">
      {/* 
        Chat 组件是一个 Client Component (因为它有 "use client")
        Next.js 会在服务端预渲染它的 HTML 结构，然后在客户端接管交互
      */}
      <Chat />
    </main>
  );
}
