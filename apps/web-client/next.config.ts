import type { NextConfig } from "next";
import * as path from "path";
import * as dotenv from "dotenv";

// 加载根目录的 .env 文件
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
