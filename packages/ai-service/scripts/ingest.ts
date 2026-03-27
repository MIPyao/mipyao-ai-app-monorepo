import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { RagConfig } from "../src/rag.config";
import ingestionConfig from "../data/ingestion_config.json";

const MONOREPO_ROOT = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(MONOREPO_ROOT, ".env") });

// 定义配置文件的类型
interface DocConfig {
  file: string;
  document_title: string;
  section_title: string;
}

const getConfigFromEnv = (): RagConfig => ({
  dbConfig: {
    host: process.env.POSTGRES_HOST!,
    port: parseInt(process.env.POSTGRES_PORT!, 10),
    database: process.env.POSTGRES_DATABASE!,
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    tableName: process.env.POSTGRES_TABLE_NAME!,
    dimensions: parseInt(process.env.POSTGRES_DIMENSIONS!, 10),
  },
  openrouterConfig: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseUrl: process.env.OPENROUTER_BASE_URL!,
    model: process.env.OPENROUTER_MODEL!,
    temperature: parseFloat(process.env.OPENROUTER_TEMPERATURE!),
  },
  siliconflowConfig: {
    apiKey: process.env.SILICONFLOW_API_KEY!,
    baseUrl: process.env.SILICONFLOW_BASE_URL!,
    embeddingModel: process.env.SILICONFLOW_EMBEDDING_MODEL!,
  },
});

const config = getConfigFromEnv();

async function clearTable(
  tableName: string,
  dbConfig: RagConfig["dbConfig"],
): Promise<void> {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    console.log(`🧹 正在清空表: ${tableName} 中的所有旧数据...`);
    await client.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY;`);
    console.log("✅ 旧数据清理完成。");
  } catch (e) {
    console.error(`❌ 清空表 ${tableName} 失败。`, e);
    throw e;
  } finally {
    await client.end();
  }
}

async function dropTableIfDimensionMismatch(
  tableName: string,
  dbConfig: RagConfig["dbConfig"],
): Promise<void> {
  const client = new Client(dbConfig);
  try {
    await client.connect();

    // 检查表是否存在
    const tableExists = await client.query(
      `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      );
    `,
      [tableName],
    );

    if (!tableExists.rows[0].exists) {
      console.log(`📋 表 ${tableName} 不存在，将创建新表。`);
      return;
    }

    // 检查向量维度
    const columnInfo = await client.query(
      `
      SELECT atttypmod 
      FROM pg_attribute 
      WHERE attrelid = $1::regclass 
      AND attname = 'embedding';
    `,
      [tableName],
    );

    if (columnInfo.rows.length > 0) {
      // atttypmod 包含维度信息，格式为 (维度 + 4)
      const currentDimension = columnInfo.rows[0].atttypmod - 4;
      console.log(
        `📊 当前表维度: ${currentDimension}, 配置维度: ${dbConfig.dimensions}`,
      );

      if (currentDimension !== dbConfig.dimensions) {
        console.log(
          `⚠️  维度不匹配 (${currentDimension} ≠ ${dbConfig.dimensions})，需要重建表。`,
        );
        await client.query(`DROP TABLE IF EXISTS "${tableName}";`);
        console.log(`✅ 已删除旧表 ${tableName}。`);
      } else {
        console.log(`✅ 维度匹配，保留现有表。`);
      }
    }
  } catch (e) {
    console.error(`❌ 检查表维度失败:`, e);
    // 如果检查失败，尝试删除表重建
    try {
      await client.query(`DROP TABLE IF EXISTS "${tableName}";`);
      console.log(`⚠️  已删除表 ${tableName}（检查失败，强制重建）。`);
    } catch (dropErr) {
      console.error(`❌ 删除表失败:`, dropErr);
    }
  } finally {
    await client.end();
  }
}

// 加载和处理文档的函数
async function loadAndEnhanceDocuments(): Promise<Document[]> {
  const allDocsToSplit: Document[] = [];
  const DATA_DIR = path.join(__dirname, "../data");

  console.log(`--- 正在处理 ${ingestionConfig.length} 个逻辑文档 ---`);

  for (const docConfig of ingestionConfig as DocConfig[]) {
    const filePath = path.join(DATA_DIR, docConfig.file);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ 警告: 文件不存在，跳过: ${docConfig.file}`);
      continue;
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");

    // 定义元数据（只保留 document_title 和 section_title）
    const metadata = {
      source: docConfig.file,
      document_title: docConfig.document_title,
      section_title: docConfig.section_title,
    };

    // 创建原始文档
    const originalDoc = new Document({ pageContent: fileContent, metadata });
    allDocsToSplit.push(originalDoc);

    console.log(
      `   ✅ 已加载 "${docConfig.document_title}" (${docConfig.section_title})\n`,
    );
  }

  return allDocsToSplit;
}

async function ingestData() {
  console.log("--- RAG 数据导入流程开始 ---");

  // 检查数据库连接
  const client = new Client(config.dbConfig);

  // 检查并处理维度不匹配的表
  try {
    await dropTableIfDimensionMismatch(
      config.dbConfig.tableName,
      config.dbConfig,
    );
  } catch (e) {
    console.error("❌ 检查表维度失败，退出导入流程:", e);
    return;
  }

  // 清理旧数据（如果表存在）
  try {
    await clearTable(config.dbConfig.tableName, config.dbConfig);
  } catch (e) {
    console.log("ℹ️  表不存在或清空失败，将在导入时创建新表。");
  }

  try {
    await client.connect();
    console.log("🚀 数据库连接成功。");
  } catch (e) {
    console.error("❌ 无法连接到数据库。请检查 Docker 容器是否运行。", e);
    return;
  } finally {
    await client.end();
  }

  try {
    // 验证配置
    console.log("📋 配置信息:");
    console.log(
      `   嵌入模型: ${config.siliconflowConfig.embeddingModel} (via SiliconFlow)`,
    );
    console.log(`   配置维度: ${config.dbConfig.dimensions}`);
    console.log(
      `   API Key: ${config.siliconflowConfig.apiKey ? "已设置" : "未设置"}`,
    );

    // 初始化 VectorStore (使用 SiliconFlow 的嵌入模型)
    const embeddings = new OpenAIEmbeddings({
      apiKey: config.siliconflowConfig.apiKey,
      modelName: config.siliconflowConfig.embeddingModel,
      configuration: {
        baseURL: config.siliconflowConfig.baseUrl,
      },
    });

    // 测试嵌入模型 - 验证实际输出维度
    console.log("🧪 测试嵌入模型...");
    try {
      const testEmbedding = await embeddings.embedQuery("test");
      const actualDimensions = testEmbedding.length;
      console.log(`   ✅ 嵌入模型实际输出维度: ${actualDimensions}`);

      if (actualDimensions === 0) {
        throw new Error("嵌入模型返回了空向量！");
      }

      if (actualDimensions !== config.dbConfig.dimensions) {
        console.warn(
          `   ⚠️  警告: 配置维度 (${config.dbConfig.dimensions}) 与模型实际维度 (${actualDimensions}) 不匹配！`,
        );
        console.warn(
          `   建议将 POSTGRES_DIMENSIONS 设置为 ${actualDimensions}`,
        );
      }
    } catch (embedTestErr: any) {
      console.error("   ❌ 嵌入模型测试失败:", embedTestErr.message);
      throw new Error(`嵌入模型初始化失败: ${embedTestErr.message}`);
    }

    const vectorStore = await PGVectorStore.initialize(embeddings, {
      tableName: config.dbConfig.tableName,
      dimensions: config.dbConfig.dimensions,
      columns: {
        contentColumnName: "content",
        vectorColumnName: "embedding",
      },
      postgresConnectionOptions: config.dbConfig,
    });

    // 加载和增强文档
    const allDocsToSplit = await loadAndEnhanceDocuments();

    if (allDocsToSplit.length === 0) {
      console.error(
        "❌ 未加载到任何有效文档，请检查 data 目录和 ingestion.config.json。",
      );
      return;
    }

    console.log(`📜 总共加载了 ${allDocsToSplit.length} 个文档。`);

    // 分割文档
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 100,
    });

    const docs = await splitter.splitDocuments(allDocsToSplit);
    console.log(`📊 文档分割成 ${docs.length} 个文本块。`);

    // 检查是否有空文档块
    const emptyDocs = docs.filter(
      (doc) => !doc.pageContent || doc.pageContent.trim().length === 0,
    );
    if (emptyDocs.length > 0) {
      console.warn(`⚠️  警告: 发现 ${emptyDocs.length} 个空文档块，将被跳过。`);
    }
    const validDocs = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.trim().length > 0,
    );
    console.log(`📝 有效文档块数量: ${validDocs.length}`);

    if (validDocs.length === 0) {
      console.error("❌ 没有有效的文档块可以导入！");
      return;
    }

    // 嵌入并入库 - 使用批量处理，避免一次性处理太多
    console.log("⚡ 正在生成向量并批量入库...");
    const batchSize = 10; // 每批处理 10 个文档
    for (let i = 0; i < validDocs.length; i += batchSize) {
      const batch = validDocs.slice(i, i + batchSize);
      console.log(
        `   处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(validDocs.length / batchSize)} (${batch.length} 个文档)...`,
      );
      await vectorStore.addDocuments(batch);
    }
    console.log("✅ 数据批量入库成功！");
    console.log(`✅ 向量库已包含 ${validDocs.length} 个文档块。`);
  } catch (err) {
    console.error("\n❌ RAG 数据导入流程失败! 详细错误:", err);
    console.error(
      "请确保：1. Docker数据库运行中。2. SiliconFlow API Key 配置正确。3. 配置文件和数据文件正确。",
    );
  }
}

ingestData();
