import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { RagConfig } from "./rag.config";
import { createRagDeps, type RagDeps } from "./agent";
import { createRagGraph } from "./rag-graph";
import { Readable } from "stream";

/**
 * RAG 服务：基于 LangGraph StateGraph 的 Agentic RAG。
 *
 * 流程由显式图拓扑 + 条件边保证（不再依赖 ReAct 的强约束 prompt）：
 *   rewrite → retrieve → rerank → check ─(充分/到上限)→ generate → END
 *                                      └─(不充分)→ expand →(回到 retrieve)
 *
 * 对外契约不变：streamQuery(query) 返回一个 Node.js Readable 流，
 * 其中 [STATUS] xxx\n 行为状态提示，其余字节为最终答案文本。
 */
export class RagService {
  private deps: RagDeps | undefined;
  private vectorStore: PGVectorStore | undefined;
  /** 共享初始化 Promise：并发请求复用同一个，避免重复初始化和 unhandled rejection */
  private initPromise: Promise<void>;

  constructor(private readonly config: RagConfig) {
    // 启动初始化并保存 Promise，拒绝会沿 await 链传播而非变成 unhandled rejection
    this.initPromise = this.initialize();
  }

  /**
   * 异步初始化 RAG 依赖：嵌入模型、向量库、LLM、各阶段纯逻辑。
   *
   * @throws {Error} 配置缺失、API 连接失败、数据库初始化异常或依赖构造失败
   */
  private async initialize(): Promise<void> {
    try {
      const { dbConfig, openrouterConfig, siliconflowConfig } = this.config;

      const embeddings = new OpenAIEmbeddings({
        apiKey: siliconflowConfig.apiKey,
        modelName: siliconflowConfig.embeddingModel,
        configuration: {
          baseURL: siliconflowConfig.baseUrl,
        },
      });

      this.vectorStore = await PGVectorStore.initialize(embeddings, {
        tableName: dbConfig.tableName,
        dimensions: dbConfig.dimensions,
        columns: {
          contentColumnName: "content",
          vectorColumnName: "embedding",
        },
        postgresConnectionOptions: dbConfig,
      });

      const llm = new ChatOpenAI({
        apiKey: openrouterConfig.apiKey,
        model: openrouterConfig.model,
        temperature: openrouterConfig.temperature,
        maxTokens: 3000,
        streamUsage: false,
        configuration: {
          baseURL: openrouterConfig.baseUrl,
        },
      });

      this.deps = createRagDeps(this.config, this.vectorStore, llm);

      console.log("✅ RagService StateGraph 依赖初始化完成");
    } catch (e: any) {
      console.error("❌ RagService 初始化失败:", e?.message || e);
      throw e;
    }
  }

  /**
   * 以流的形式异步查询并实时返回状态与最终答案。
   *
   * 创建对外 Readable 流，为本次查询编译一个 StateGraph（注入该流），
   * 用 invoke 驱动整个图执行。状态提示和答案由各节点直接推流。
   *
   * @param {string} query - 用户输入的查询字符串
   * @returns {Promise<Readable>} 含状态行和最终答案的可读流
   * @throws {Error} 依赖未初始化成功
   */
  async streamQuery(query: string): Promise<Readable> {
    // 复用共享 initPromise，并发请求不会触发第二次 initialize()
    await this.initPromise;
    if (!this.deps) {
      throw new Error("Agent 未初始化成功");
    }

    const readable = new Readable({ read() {} });

    (async () => {
      try {
        console.log(`\n${"=".repeat(50)}`);
        console.log(`🔎 收到查询: ${query}`);
        console.log(`${"=".repeat(50)}`);

        // 为本次查询构造独立的 graph 实例（注入对外流），用 invoke 驱动
        const graph = createRagGraph(this.deps!, readable);
        await graph.invoke({ query });

        console.log(`\n✅ 流式回答完毕`);
        console.log(`${"=".repeat(50)}\n`);

        readable.push(null);
      } catch (error) {
        console.error("StateGraph 执行错误:", error);
        readable.push("抱歉，处理请求时出现错误。");
        readable.push(null);
      }
    })();

    return readable;
  }
}
