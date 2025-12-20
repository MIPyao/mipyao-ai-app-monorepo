/**
 * 测试脚本：列出可用的 Gemini 模型
 * 用于诊断模型名称错误问题
 */

import * as dotenv from "dotenv";
import * as path from "path";

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

async function listAvailableModels() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY 未设置");
    return;
  }

  console.log("🔍 正在查询可用的 Gemini 模型...\n");

  try {
    // 使用 REST API 直接调用 Google 的模型列表端点
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API 请求失败: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    const data = await response.json();

    if (!data.models || data.models.length === 0) {
      console.log("⚠️  未找到可用模型");
      return;
    }

    console.log("✅ 可用的模型列表：\n");

    // 过滤出支持 generateContent 的模型
    const supportedModels = data.models.filter((model: any) =>
      model.supportedGenerationMethods?.includes("generateContent"),
    );

    if (supportedModels.length === 0) {
      console.log("⚠️  未找到支持 generateContent 的模型");
    } else {
      console.log("支持 generateContent 的模型（可用于聊天）：");
      supportedModels.forEach((model: any) => {
        // 提取模型名称（去掉 models/ 前缀）
        const modelName = model.name.replace("models/", "");
        console.log(`  - ${modelName}`);
        if (model.displayName) {
          console.log(`    显示名称: ${model.displayName}`);
        }
        if (model.description) {
          console.log(`    描述: ${model.description}`);
        }
        console.log("");
      });
    }

    // 也显示所有模型
    console.log("\n所有可用模型：");
    data.models.forEach((model: any) => {
      const modelName = model.name.replace("models/", "");
      console.log(`  - ${modelName}`);
    });

    // 推荐配置
    console.log("\n💡 推荐配置（在 .env 文件中）：");
    const recommendedModels = supportedModels
      .map((m: any) => m.name.replace("models/", ""))
      .filter((name: string) => name.includes("flash") || name.includes("pro"))
      .slice(0, 3);

    if (recommendedModels.length > 0) {
      console.log(`   GEMINI_LLM_MODEL=${recommendedModels[0]}`);
    } else if (supportedModels.length > 0) {
      const firstModel = supportedModels[0].name.replace("models/", "");
      console.log(`   GEMINI_LLM_MODEL=${firstModel}`);
    }
  } catch (error: any) {
    console.error("❌ 查询模型列表失败:", error.message);

    if (error.message.includes("API key") || error.message.includes("401")) {
      console.error("\n⚠️  API Key 可能无效，请检查 GEMINI_API_KEY");
    } else if (error.message.includes("fetch")) {
      console.error("\n⚠️  网络请求失败，请检查网络连接或防火墙设置");
    }
  }
}

// 运行
listAvailableModels().catch(console.error);
