import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const albertSans = Albert_Sans({
  variable: "--font-albert",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "AI 简历助手 | RAG Chat",
  description: "基于 RAG 技术的智能简历问答助手，快速了解赵耀的专业技能与项目经验。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${outfit.variable} ${albertSans.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
