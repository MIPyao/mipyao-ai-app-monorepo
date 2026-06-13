import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { RagConfig } from "./rag.config";
import { createAgentTools } from "./agent";
import { Readable } from "stream";

const AGENT_SYSTEM_PROMPT = `你是一个专业的简历问答助手。你的唯一任务是**极度严格地**根据提供的"上下文"来回答用户的问题。

请严格遵守以下规则：

1. **角色和口吻：** 你的回答必须**全程**以"赵耀"的口吻（第一人称）来陈述简历中的事实和经历。

2. **内容绝对限制：** 答案中的**所有信息**必须能够直接或通过简单归纳从提供的上下文中找到。**绝不允许**添加、推测、编造任何上下文中不存在的内容、技术或经历。

3. **格式严格限制：** 严格按照文档中的原始格式回答，不要自己组织新的结构。

4. **输出格式：** 请使用简洁、专业的语言组织回复。如果上下文中包含 Markdown 格式，请保留这些格式。

5. **推理和归纳：** 针对"精通哪些技术"或"主要负责什么"这类问题，请直接从上下文中提取技术清单，并用简洁的列表格式展示。

6. **处理无法回答的情况：** 如果上下文信息不足以回答问题，回复："我无法从提供的简历信息中找到确切答案。"

## 强制工作流程（必须按顺序执行，不能跳过任何步骤）

你必须严格按照以下步骤执行，不能跳过任何一步：

**第一步：调用 retrieve 工具**
- 从简历数据库检索相关信息
- 记住检索到的内容

**第二步：调用 rerank 工具**
- 将第一步检索到的文档传入
- 获取精排后的 top 3 结果

**第三步：调用 check_sufficiency 工具**
- 检查精排后的信息是否足以回答问题
- 如果返回 sufficient: true，进入第四步
- 如果返回 sufficient: false，记录 missingInfo，然后调用 expand_query 生成新查询，再从第一步重新开始（最多重复 2 次）

**第四步：生成最终回答**
- 使用精排后的上下文，以赵耀的口吻回答用户问题
- 直接输出回答内容，不要输出工具调用过程

⚠️ 重要：你必须先调用 retrieve，然后 rerank，然后 check_sufficiency，最后才能回答。不能跳过任何步骤！`;

export class RagService {
  private agent: any;
  private vectorStore: PGVectorStore | undefined;

  constructor(private readonly config: RagConfig) {
    this.initializeAgent();
  }

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

  async streamQuery(query: string): Promise<Readable> {
    if (!this.agent) {
      await this.initializeAgent();
      if (!this.agent) {
        throw new Error("Agent 未初始化成功");
      }
    }

    const readable = new Readable({ read() {} });

    (async () => {
      try {
        console.log(`\n${"=".repeat(50)}`);
        console.log(`🔎 收到查询: ${query}`);
        console.log(`${"=".repeat(50)}`);

        const statusMap: Record<string, string> = {
          retrieve: "正在检索相关信息...",
          rerank: "正在精排文档...",
          check_sufficiency: "正在检查信息充分性...",
          expand_query: "正在扩展查询...",
        };

        let allMessages: any[] = [];

        for await (const chunk of await this.agent.stream({
          messages: [{ role: "user", content: query }],
        })) {
          if (chunk.agent?.messages) {
            allMessages = chunk.agent.messages;
            const lastMsg = allMessages[allMessages.length - 1];
            if (lastMsg._getType() === "ai" && lastMsg.tool_calls?.length) {
              const toolName = lastMsg.tool_calls[0].name;
              const status = statusMap[toolName] || `正在执行 ${toolName}...`;
              readable.push(`[STATUS] ${status}\n`);
              console.log(`   🔧 工具调用: ${toolName}`);
            }
          }
        }

        // Extract the final response
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
