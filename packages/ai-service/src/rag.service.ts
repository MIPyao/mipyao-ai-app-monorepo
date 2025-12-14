import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OllamaEmbeddings, Ollama } from "@langchain/ollama";
import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import {
  RunnablePassthrough,
  RunnableSequence,
} from "@langchain/core/runnables";
import { PromptTemplate } from "@langchain/core/prompts";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { RagConfig } from "./rag.config";
import { Readable } from "stream";

class ContextLogger extends BaseCallbackHandler {
  name = "ContextLogger";

  // 使用 handleRetrieverEnd 钩子来捕获检索结果
  async handleRetrieverEnd(documents: Document[]): Promise<void> {
    // 将检索到的文档内容合并并打印
    const context = documents.map((doc) => doc.pageContent).join("\n\n");

    if (context) {
      console.log("\n------------------------------------------");
      console.log("🤖 RAG 检索到的上下文 (Context):");
      console.log(context);
      console.log("------------------------------------------\n");
    }
  }
}

const SYSTEM_PROMPT = `
你是一个专业的简历问答助手。你的唯一任务是**极度严格地**根据提供的"上下文"来回答用户的问题。

请严格遵守以下规则：

1. **角色和口吻：** 你的回答必须**全程**以"赵耀"的口吻（第一人称）来陈述简历中的事实和经历。例如："我于2011.09-2015.06在北京信息科技大学就读计算机科学与技术专业，本科学历。"

2. **内容绝对限制：** 答案中的**所有信息**必须能够直接或通过简单归纳从提供的上下文中找到。**绝不允许**添加、推测、编造任何上下文中不存在的内容、技术或经历。

3. **格式严格限制（重要）：** 
   - **严格按照文档中的原始格式回答**，不要自己组织新的结构（如"本科阶段"、"研究生阶段"、"博士后阶段"等）。
   - 如果文档中只有一行信息，就只回答那一行信息，不要扩展或编造其他内容。
   - **不要将项目名称、工作经历等信息误认为是教育背景**。教育背景只包括：时间、学校、专业、学历层次。
   - 如果上下文中没有明确提到"研究生"、"硕士"、"博士"、"博士后"等学历，就**绝对不要**编造这些信息。

4. **输出格式：** 请使用简洁、专业的语言组织回复。如果上下文中包含 Markdown 格式（如列表、粗体），请保留这些格式以突出重点。

5. **推理和归纳：** 针对"精通哪些技术"或"主要负责什么"这类问题，请直接从上下文中提取技术清单，并用简洁的列表格式展示。

6. **处理无法回答的情况（首要规则）：** 如果提供的上下文信息不足以回答用户的问题（哪怕是缺少一个细节），你必须且只能回复以下这句话，不添加任何额外解释或道歉：
   "我无法从提供的简历信息中找到确切答案。"
`;
// 预设 Prompt Template
const RAG_PROMPT_TEMPLATE = `
${SYSTEM_PROMPT}

**上下文 (Context):**
{context}

**用户问题 (Question):**
{question}
`;

export class RagService {
  private chain: RunnableSequence<any, string> | undefined;
  private vectorStore: PGVectorStore | undefined;

  constructor(private readonly config: RagConfig) {
    // 在构造函数中立即初始化 Chain
    this.initializeChain();
  }

  /**
   * 融合检索：结合向量相似度和元数据匹配
   * @param query 用户查询
   * @param k 返回的文档数量
   * @returns 检索到的文档列表
   */
  private async hybridRetrieve(
    query: string,
    k: number = 3
  ): Promise<Document[]> {
    if (!this.vectorStore) {
      throw new Error("VectorStore 未初始化");
    }

    // 1. 向量相似度检索（获取更多候选，用于后续筛选）
    const vectorResults = await this.vectorStore.similaritySearchWithScore(
      query,
      k * 2
    );

    // 2. 从查询中提取关键词，用于匹配 document_title 和 section_title
    const queryKeywords = this.extractQueryKeywords(query);

    // 3. 计算每个文档的融合分数
    const scoredDocs = vectorResults.map(([doc, score]) => {
      const metadataScore = this.calculateMetadataScore(doc, queryKeywords);
      // 融合分数：向量相似度 (0-1) * 0.6 + 元数据匹配分数 (0-1) * 0.4
      const hybridScore = score * 0.6 + metadataScore * 0.4;
      return { doc, score: hybridScore, vectorScore: score, metadataScore };
    });

    // 4. 按融合分数排序并返回前 k 个
    const topDocs = scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((item) => item.doc);

    console.log(
      `🔍 融合检索完成: 向量检索 ${vectorResults.length} 个候选，返回前 ${k} 个`
    );
    if (scoredDocs.length > 0) {
      const top = scoredDocs[0];
      console.log(
        `   最高分文档: ${top.doc.metadata?.document_title || "未知"} (向量: ${top.vectorScore.toFixed(3)}, 元数据: ${top.metadataScore.toFixed(3)}, 融合: ${top.score.toFixed(3)})`
      );
    }

    return topDocs;
  }

  /**
   * 从查询中提取关键词
   */
  private extractQueryKeywords(query: string): string[] {
    // 提取中文和英文关键词
    const keywords: string[] = [];

    // 提取中文词（2个字符以上）
    const chineseWords = query.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    keywords.push(...chineseWords);

    // 提取英文单词（3个字符以上）
    const englishWords = query.match(/[A-Za-z]{3,}/g) || [];
    keywords.push(...englishWords.map((w) => w.toLowerCase()));

    return keywords;
  }

  /**
   * 计算文档的元数据匹配分数
   */
  private calculateMetadataScore(
    doc: Document,
    queryKeywords: string[]
  ): number {
    if (queryKeywords.length === 0) return 0.5; // 如果没有关键词，给中等分数

    const documentTitle = (doc.metadata?.document_title || "").toLowerCase();
    const sectionTitle = (doc.metadata?.section_title || "").toLowerCase();

    let totalScore = 0;

    for (const keyword of queryKeywords) {
      const lowerKeyword = keyword.toLowerCase();

      // 在 document_title 中匹配（权重更高）
      if (documentTitle.includes(lowerKeyword)) {
        totalScore += 1.0; // document_title 匹配权重 1.0
      }

      // 在 section_title 中匹配
      if (sectionTitle.includes(lowerKeyword)) {
        totalScore += 0.6; // section_title 匹配权重 0.6
      }
    }

    // 归一化到 0-1 范围
    // 如果所有关键词都匹配，分数为 1.0
    const maxPossibleScore = queryKeywords.length * 1.6; // 假设每个关键词都能在 document_title 和 section_title 中匹配
    const normalizedScore =
      maxPossibleScore > 0 ? Math.min(totalScore / maxPossibleScore, 1.0) : 0.5;

    return normalizedScore;
  }

  private async initializeChain() {
    try {
      const { dbConfig, ollamaConfig } = this.config;
      // 1. 初始化嵌入模型
      const embeddings = new OllamaEmbeddings({
        model: ollamaConfig.embeddingModel,
      });

      // 2. 连接到已有的 VectorStore
      this.vectorStore = await PGVectorStore.initialize(embeddings, {
        tableName: dbConfig.tableName,
        dimensions: dbConfig.dimensions,
        // 配置必须与 ingest.ts 中创建时的列名保持一致
        columns: {
          contentColumnName: "content",
          vectorColumnName: "embedding",
        },
        postgresConnectionOptions: dbConfig,
      });

      // 3. 创建自定义 Retriever（使用融合检索）
      const retriever = {
        getRelevantDocuments: async (query: string) => {
          return await this.hybridRetrieve(query, 3);
        },
      };

      // 4. 初始化 LLM，**修正为 Qwen-1.8B**
      const llm = new Ollama({
        model: ollamaConfig.llmModel,
        temperature: ollamaConfig.temperature, // 降低温度，减少随机性，使其更倾向于事实性回答
        repeatPenalty: ollamaConfig.repeatPenalty, // 重复惩罚因子。高于 1.0 会抑制模型重复自身的 token。
        numPredict: 500, // 限制输出长度，防止无限重复
      }); // 确保 Ollama 中模型名称是 qwen:1.8b

      // 5. 创建 Prompt Template
      const prompt = PromptTemplate.fromTemplate(RAG_PROMPT_TEMPLATE);

      // 6. 定义 Chain 流程 (LCEL)
      this.chain = RunnableSequence.from([
        // 步骤 A: 检索上下文（使用融合检索）
        {
          context: new RunnablePassthrough().pipe(async (query: string) => {
            const docs = await retriever.getRelevantDocuments(query);
            return docs
              .map((doc) => {
                // 在上下文中包含元数据信息，帮助 LLM 更好地理解上下文
                const title = doc.metadata?.document_title || "";
                const section = doc.metadata?.section_title || "";
                const prefix = title
                  ? `[${title}${section ? " - " + section : ""}]\n`
                  : "";
                return prefix + doc.pageContent;
              })
              .join("\n\n");
          }),
          question: new RunnablePassthrough(), // 将原始查询作为 question 传递
        },
        prompt, // 步骤 B: 格式化 Prompt
        llm, // 步骤 C: 调用 LLM
        new StringOutputParser(), // 步骤 D: 解析输出
      ]);

      console.log("✅ RagService 链初始化完成，可以处理请求了。");
    } catch (e) {
      console.error(
        "❌ RagService 初始化失败。请检查 Ollama 和 PGVector 连接:",
        e
      );
    }
  }

  /**
   * ✅ 核心方法：执行 RAG 流程，并直接返回 Node.js Readable Stream。
   * @param query 用户的问题
   * @returns Node.js Readable Stream，包含文本块。
   */
  async streamQuery(query: string): Promise<Readable> {
    if (!this.chain) {
      await this.initializeChain();
      if (!this.chain) {
        throw new Error("RAG Chain 未初始化成功，无法处理请求。");
      }
    }

    try {
      console.log(`🔎 正在处理流式查询: ${query}`);

      // 1. 调用 .stream() 方法，获取 LangChain 的 AsyncGenerator
      const asyncGenerator = await this.chain.stream(query, {
        callbacks: [new ContextLogger()],
      });

      // 2. 创建 Node.js Readable Stream
      const readable = new Readable({
        objectMode: false,
        read() {}, // 必须实现 read
      });

      // 3. 异步消费 AsyncGenerator 并推送到 Readable
      (async () => {
        try {
          for await (const chunk of asyncGenerator) {
            // 推送数据块
            readable.push(chunk, "utf-8");
          }
          // 推送 null 结束流
          readable.push(null);
        } catch (error) {
          console.error("LangChain 流处理错误:", error);
          readable.emit("error", error);
          readable.push(null);
        }
      })();

      return readable;
    } catch (e) {
      console.error("RAG 检索/生成失败:", e);
      throw new Error("AI 服务处理请求失败。");
    }
  }

  /**
   * 处理用户查询，执行 RAG 检索和生成。
   * @param query 用户的问题
   * @returns LLM 生成的回答
   */
  async retrieveAndGenerate(query: string): Promise<string> {
    if (!this.chain) {
      // 如果初始化失败，尝试重新初始化一次 (以防连接延迟)
      await this.initializeChain();
      if (!this.chain) {
        throw new Error("RAG Chain 未初始化成功，无法处理请求。");
      }
    }

    try {
      console.log(`🔎 正在处理查询: ${query}`);

      // 使用 callbacks 配置来打印检索到的上下文
      const result = await this.chain.invoke(query, {
        callbacks: [new ContextLogger()],
      });

      return result;
    } catch (e) {
      console.error("RAG 检索/生成失败:", e);
      throw new Error("AI 服务处理请求失败。请检查 Ollama 连接。");
    }
  }
}
