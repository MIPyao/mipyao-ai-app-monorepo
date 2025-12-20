import * as dotenv from "dotenv";
import * as path from "path";
import { RagService } from "../src/rag.service";
import { RagConfig } from "../src/rag.config";

const MONOREPO_ROOT = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(MONOREPO_ROOT, ".env") });

const getConfigFromEnv = (): RagConfig => ({
  dbConfig: {
    // 使用 process.env 读取变量，并确保类型转换正确
    host: process.env.POSTGRES_HOST!,
    port: parseInt(process.env.POSTGRES_PORT!, 10),
    database: process.env.POSTGRES_DATABASE!,
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    tableName: process.env.POSTGRES_TABLE_NAME!,
    dimensions: parseInt(process.env.POSTGRES_DIMENSIONS!, 10),
  },
  geminiConfig: {
    apiKey: process.env.GEMINI_API_KEY!,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL!,
    llmModel: process.env.GEMINI_LLM_MODEL!,
    temperature: parseFloat(process.env.GEMINI_LLM_TEMPERATURE!),
  },
});

async function testRagService(
  ragService: RagService,
  query: string,
  retryOnQuota: boolean = false,
) {
  console.log(`\n🗣️ 正在向 RAG Service 提问 (非流式): ${query}`);

  try {
    const answer = await ragService.retrieveAndGenerate(query);

    console.log("\n✅ RAG Service 响应成功：");
    console.log("------------------------------------------");
    console.log(answer.trim());
    console.log("------------------------------------------");
  } catch (error: any) {
    console.error("\n❌ RAG Service 测试失败！");

    // 检查是否是配额错误
    if (
      error?.status === 429 ||
      error?.isQuotaError ||
      error?.message?.includes("429") ||
      error?.message?.includes("quota")
    ) {
      const retryDelay = error?.retryDelay || 60; // 默认等待 60 秒

      if (retryOnQuota && retryDelay > 0 && retryDelay < 300) {
        // 如果重试延迟小于 5 分钟，可以选择自动重试
        console.error(
          `\n⏳ 检测到配额限制，将在 ${retryDelay} 秒后自动重试...`,
        );
        console.error("   (按 Ctrl+C 取消)");

        await new Promise((resolve) => setTimeout(resolve, retryDelay * 1000));

        console.log("\n🔄 开始重试...");
        return testRagService(ragService, query, false); // 只重试一次
      } else {
        console.error("\n⚠️  配额错误详情:");
        console.error(`   错误信息: ${error?.message || error}`);
        if (retryDelay) {
          console.error(`   建议等待时间: ${retryDelay} 秒`);
        }
      }
    } else {
      console.error("错误详情:", error);
    }
  }
}

// ----------------------------------------------------
// 2. 流式测试函数 (传入已初始化的服务)
// ----------------------------------------------------
async function testRAGStreaming(ragService: RagService, query: string) {
  console.log(`\n==========================================`);
  console.log(`🚀 开始流式查询测试: ${query}`);
  console.log(`==========================================`);

  try {
    // ⚠️ 现在 stream 变量接收的是 Node.js Readable Stream
    const stream = await ragService.streamQuery(query);
    let fullResponse = "";

    // 核心改动：使用 promise 包装 stream 的 data 和 end 事件进行消费
    process.stdout.write("🤖 回答: "); // 打印前缀

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => {
        const textChunk = chunk.toString();
        process.stdout.write(textChunk); // 实时打印到控制台
        fullResponse += textChunk;
      });

      stream.on("end", () => {
        resolve(); // 流结束，Promise 解决
      });

      stream.on("error", (error) => {
        reject(error); // 遇到错误，Promise 拒绝
      });
    });

    console.log("\n\n------------------------------------------");
    console.log(`✅ 流式输出完成。总长度: ${fullResponse.length}`);
    console.log("------------------------------------------");
  } catch (error: any) {
    console.error("\n❌ 流式测试失败:", error);

    // 检查是否是配额错误
    if (
      error?.status === 429 ||
      error?.isQuotaError ||
      error?.message?.includes("429") ||
      error?.message?.includes("quota")
    ) {
      const retryDelay = error?.retryDelay || 60;
      console.error(`\n⚠️  配额限制错误。建议等待 ${retryDelay} 秒后重试。`);
    }
  }
}

// ----------------------------------------------------
// 3. 顶级启动函数
// ----------------------------------------------------
async function main() {
  const config = getConfigFromEnv();
  console.log("--- RAG Service 独立测试开始 ---");
  console.log(
    `💡 RAG配置加载成功，DB: ${config.dbConfig.database}, LLM: ${config.geminiConfig.llmModel}`,
  );

  // 实例化服务（只做一次）
  const ragService = new RagService(config);

  // 假设您在 RagService 内部的 initializeChain 是异步的，
  // 我们必须等待它完成，即使它在构造函数中被调用。
  // 在您的 RagService 中没有暴露初始化完成的 promise，所以我们仍然使用 setTimeout 等待，
  // 或者最好：将 RagService 的初始化逻辑封装在一个可等待的 async init() 方法中。
  // 为了简化，我们沿用 setTimeout 等待机制。
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 同步执行：先执行非流式测试，再执行流式测试

  // A. 非流式测试 - 测试融合检索效果
  console.log("\n📋 测试 1: 测试元数据匹配（包含 document_title 关键词）");
  await testRagService(
    ragService,
    "赵耀的基本信息是什么？包括生日、毕业院校等。",
  );

  console.log("\n📋 测试 2: 测试元数据匹配（包含 section_title 关键词）");
  await testRagService(ragService, "赵耀在 Vue 项目中的工作经历是什么？");

  console.log("\n📋 测试 3: 测试向量相似度检索");
  await testRagService(ragService, "北航的前端工程师赵耀生日是什么时候？");

  // B. 流式测试 - 测试包含多个关键词的查询
  console.log("\n📋 测试 4: 流式测试 - 专业技能相关");
  await testRAGStreaming(ragService, "赵耀精通哪些技术？请简洁列出。");

  console.log("\n📋 测试 5: 流式测试 - 项目经历相关");
  await testRAGStreaming(ragService, "赵耀在科技部项目中使用了哪些技术栈？");
}

// 运行顶级函数
main();
