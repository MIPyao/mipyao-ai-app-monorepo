import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OllamaEmbeddings } from "@langchain/ollama";
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
  ollamaConfig: {
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL!,
    llmModel: process.env.OLLAMA_LLM_MODEL!,
    temperature: parseFloat(process.env.OLLAMA_LLM_TEMPERATURE!),
    repeatPenalty: parseFloat(process.env.OLLAMA_LLM_REPEAT_PENALTY!),
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

  // 清理旧数据
  try {
    await clearTable(config.dbConfig.tableName, config.dbConfig);
  } catch (e) {
    console.error("❌ 清空表失败，退出导入流程:", e);
    return;
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
    // 初始化 VectorStore
    const embeddings = new OllamaEmbeddings({
      model: config.ollamaConfig.embeddingModel,
    });

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

    // 嵌入并入库
    console.log("⚡ 正在生成向量并批量入库...");
    await vectorStore.addDocuments(docs);
    console.log("✅ 数据批量入库成功！");
    console.log(`✅ 向量库已包含 ${docs.length} 个文档块。`);
  } catch (err) {
    console.error("\n❌ RAG 数据导入流程失败! 详细错误:", err);
    console.error(
      "请确保：1. Docker数据库运行中。2. Ollama 服务运行中。3. 配置文件和数据文件正确。",
    );
  }
}

ingestData();
