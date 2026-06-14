import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { RagConfig } from "./rag.config";
import { createAgentTools } from "./agent";
import { Readable } from "stream";

const AGENT_SYSTEM_PROMPT = `你是一个专业的简历问答助手。你的唯一任务是**极度严格地**根据提供的"上下文"来回答用户的问题。

你现在有以下工具可用：
- rewrite_query: 将复杂问题拆分为多个子查询
- retrieve: 从简历数据库检索信息
- rerank: 对检索结果重排序
- check_sufficiency: 检查信息是否充分
- expand_query: 生成更精准的搜索查询

请严格遵守以下规则：

1. **角色和口吻：** 你的回答必须**全程**以"赵耀"的口吻（第一人称）来陈述简历中的事实和经历。

2. **内容绝对限制：** 答案中的**所有信息**必须能够直接或通过简单归纳从提供的上下文中找到。**绝不允许**添加、推测、编造任何上下文中不存在的内容、技术或经历。

3. **格式严格限制：** 严格按照文档中的原始格式回答，不要自己组织新的结构。

4. **输出格式：** 请使用简洁、专业的语言组织回复。如果上下文中包含 Markdown 格式，请保留这些格式。

5. **推理和归纳：** 针对"精通哪些技术"或"主要负责什么"这类问题，请直接从上下文中提取技术清单，并用简洁的列表格式展示。

6. **处理无法回答的情况：** 如果上下文信息不足以回答问题，回复："我无法从提供的简历信息中找到确切答案。"

## 强制工作流程（必须按顺序执行，不能跳过任何步骤）

你必须严格按照以下步骤执行，不能跳过任何一步：

**第一步：调用 rewrite_query 工具（如果问题涉及多个主题）**
- 如果问题涉及多个主题（如"做过什么项目？用过什么技术？"），先调用 rewrite_query 拆分
- 如果问题简单明确，跳过此步骤

**第二步：调用 retrieve 工具**
- 对每个子查询（或原始查询）调用 retrieve 检索
- 合并所有检索结果

**第三步：调用 rerank 工具**
- 将检索到的文档传入
- 获取精排后的 top 3 结果

**第四步：调用 check_sufficiency 工具**
- 检查精排后的信息是否足以回答问题
- 如果返回 sufficient: true，进入第五步
- ⚠️ 如果返回 sufficient: false，你必须执行以下操作（不能跳过）：
  1. 从返回结果中提取 missingInfo
  2. 调用 expand_query 工具，传入 query=原始问题, missingInfo=缺失信息, foundInfo=已找到的信息
  3. 使用 expand_query 返回的新查询，调用 retrieve 重新检索
  4. 再次调用 rerank 精排
  5. 再次调用 check_sufficiency 检查
  6. 最多重复此迭代 2 次

**第五步：生成最终回答**
- 使用精排后的上下文，以赵耀的口吻回答用户问题
- 直接输出回答内容，不要输出工具调用过程

⚠️ 重要：
1. 你必须先调用 retrieve，然后 rerank，然后 check_sufficiency，最后才能回答。不能跳过任何步骤！
2. 当 check_sufficiency 返回 sufficient: false 时，你必须调用 expand_query 进行迭代，不能直接生成回答！`;

export class RagService {
  private agent: any;
  private vectorStore: PGVectorStore | undefined;

  constructor(private readonly config: RagConfig) {
    this.initializeAgent();
  }

  /**
   * 异步初始化 RAG (检索增强生成) Agent。
   * 
   * 该方法负责配置和初始化 Agent 运行所需的全部组件，包括：
   * 1. 配置向量嵌入模型，使用 SiliconFlow 的 API 和指定的嵌入模型。
   * 2. 初始化 PostgreSQL 向量存储库，并建立与数据库的连接。
   * 3. 配置大语言模型 (LLM)，使用 OpenRouter 的 API 和指定的聊天模型。
   * 4. 创建并注册 Agent 所需的工具集（重写、检索、重排、检查、扩展）。
   * 5. 构建基于 ReAct 模式的 LangGraph Agent，并注入系统提示词。
   * 
   * @returns {Promise<void>} 无返回值
   * @throws {Error} 如果配置缺失、API 连接失败、数据库初始化异常或 Agent 创建失败，则抛出错误
   */
  private async initializeAgent() {
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

      const tools = createAgentTools(this.config, this.vectorStore, llm);

      // @ts-ignore - subpath export not resolved by moduleResolution: Node
      const { createReactAgent } = await import("@langchain/langgraph/prebuilt");

      this.agent = createReactAgent({
        llm,
        tools: [
          tools.rewriteTool,
          tools.retrieveTool,
          tools.rerankTool,
          tools.checkTool,
          tools.expandTool,
        ],
        messageModifier: AGENT_SYSTEM_PROMPT,
      });

      console.log("✅ RagService Agent 初始化完成");
    } catch (e: any) {
      console.error("❌ RagService Agent 初始化失败:", e?.message || e);
      throw e;
    }
  }

 /**
   * 以流的形式异步查询 Agent 并实时返回状态与最终结果。
   * 
   * 该方法会检查 Agent 是否已初始化，若未初始化则尝试初始化。在执行查询时，
   * 会将 Agent 的工具调用阶段映射为可读的状态信息并推送到流中，最后提取
   * Agent 的最终文本回答推送到流中。如果执行过程中发生错误，将返回友好的
   * 错误提示信息。
   *
   * @param {string} query - 用户输入的查询字符串。
   * @returns {Promise<Readable>} 返回一个 Promise，解析为包含状态信息和最终回答的 Node.js 可读流 (Readable)。
   * @throws {Error} 如果 Agent 初始化失败，则抛出错误。
   */
  async streamQuery(query: string): Promise<Readable> {
    if (!this.agent) {
      await this.initializeAgent();
      if (!this.agent) {
        throw new Error("Agent 未初始化成功");
      }
    }

    const readable = new Readable({ read() {} });

    // 使用立即执行异步函数处理查询
    (async () => {
      try {
        // 打印分隔线和查询信息
        console.log(`\n${"=".repeat(50)}`);
        console.log(`🔎 收到查询: ${query}`);
        console.log(`${"=".repeat(50)}`);

        // 定义状态映射表，将工具名称映射为状态描述
        const statusMap: Record<string, string> = {
          rewrite_query: "正在拆分复杂问题...",
          retrieve: "正在检索相关信息...",
          rerank: "正在精排文档...",
          check_sufficiency: "正在检查信息充分性...",
          expand_query: "正在扩展查询...",
        };

        // 初始化消息数组，用于存储所有消息
        let allMessages: any[] = [];

        // 使用for await循环处理agent的流式响应
        for await (const chunk of await this.agent.stream({
          messages: [{ role: "user", content: query }],
        })) {
          // 检查chunk中是否包含agent消息
          if (chunk.agent?.messages) {
            allMessages = chunk.agent.messages;
            const lastMsg = allMessages[allMessages.length - 1];
            // 如果是AI类型消息且包含工具调用，则更新状态
            if (lastMsg._getType() === "ai" && lastMsg.tool_calls?.length) {
              const toolName = lastMsg.tool_calls[0].name;
              const status = statusMap[toolName] || `正在执行 ${toolName}...`;
              readable.push(`[STATUS] ${status}\n`);
              console.log(`   🔧 工具调用: ${toolName}`);
            }
          }
        }

        // 从消息中提取最终回答内容
        let responseContent = "";
        for (const msg of allMessages) {
          if (msg._getType() === "ai" && typeof msg.content === "string" && msg.content && !msg.tool_calls?.length) {
            responseContent = msg.content;
          }
        }

        console.log(`\n✅ 生成回答 (${responseContent.length} 字)`);
        console.log(`${"=".repeat(50)}\n`);

        if (responseContent) {
          readable.push(responseContent);
        } else {
          readable.push("我无法从提供的简历信息中找到确切答案。");
        }

        readable.push(null);
      } catch (error) {
        console.error("Agent 执行错误:", error);
        readable.push("抱歉，处理请求时出现错误。");
        readable.push(null);
      }
    })();

    return readable;
  }
}
