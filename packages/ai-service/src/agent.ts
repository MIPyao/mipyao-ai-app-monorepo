import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";
import { SiliconFlowReranker } from "./reranker";
import { SufficiencyChecker } from "./sufficiency-checker";
import { QueryExpander } from "./query-expander";
import { RagConfig } from "./rag.config";

export interface AgentTools {
  retrieveTool: DynamicStructuredTool;
  rerankTool: DynamicStructuredTool;
  checkTool: DynamicStructuredTool;
  expandTool: DynamicStructuredTool;
}

export function createAgentTools(
  config: RagConfig,
  vectorStore: PGVectorStore,
  llm: ChatOpenAI,
): AgentTools {
  const reranker = new SiliconFlowReranker({
    apiKey: config.siliconflowConfig.apiKey,
    baseUrl: config.siliconflowConfig.baseUrl,
    model: config.siliconflowConfig.rerankModel,
  });

  const checker = new SufficiencyChecker(llm);
  const expander = new QueryExpander(llm);

  async function hybridRetrieve(
    query: string,
    k: number = 6,
  ): Promise<Document[]> {
    const vectorResults = await vectorStore.similaritySearchWithScore(query, k);
    return vectorResults
      .sort((a, b) => a[1] - b[1])
      .slice(0, k)
      .map(([doc]) => doc);
  }

  const retrieveTool = tool(
    async ({ query }) => {
      const docs = await hybridRetrieve(query, 6);
      const context = docs
        .map((doc) => {
          const title = doc.metadata?.document_title || "";
          const section = doc.metadata?.section_title || "";
          const prefix = title
            ? `[${title}${section ? " - " + section : ""}]\n`
            : "";
          return prefix + doc.pageContent;
        })
        .join("\n\n");

      return JSON.stringify({
        documentCount: docs.length,
        context,
      });
    },
    {
      name: "retrieve",
      description:
        "从简历向量数据库中检索相关信息。输入应该是搜索查询文本。",
      schema: z.object({
        query: z.string().describe("搜索查询文本"),
      }),
    },
  );

  const rerankTool = tool(
    async ({ query, context }) => {
      const docs = context
        .split("\n\n")
        .filter(Boolean)
        .map((text) => new Document({ pageContent: text }));

      const reranked = await reranker.rerank(query, docs, 3);
      const rerankedContext = reranked.map((d) => d.pageContent).join("\n\n");

      return JSON.stringify({
        documentCount: reranked.length,
        context: rerankedContext,
      });
    },
    {
      name: "rerank",
      description:
        "对检索结果进行重排序，返回最相关的 top 3 结果。",
      schema: z.object({
        query: z.string().describe("原始查询"),
        context: z.string().describe("检索到的文档内容"),
      }),
    },
  );

  const checkTool = tool(
    async ({ query, context }) => {
      const result = await checker.check(query, context);
      return JSON.stringify(result);
    },
    {
      name: "check_sufficiency",
      description:
        "检查检索到的信息是否足以回答用户问题。返回 sufficient/missingInfo/reason。",
      schema: z.object({
        query: z.string().describe("用户原始问题"),
        context: z.string().describe("检索到的上下文"),
      }),
    },
  );

  const expandTool = tool(
    async ({ query, missingInfo, foundInfo }) => {
      const expandedQuery = await expander.expand(query, missingInfo, foundInfo);
      return JSON.stringify({ expandedQuery });
    },
    {
      name: "expand_query",
      description:
        "根据缺失信息生成更精准的搜索查询，用于第二轮检索。",
      schema: z.object({
        query: z.string().describe("用户原始问题"),
        missingInfo: z.string().describe("缺失的信息"),
        foundInfo: z.string().describe("已找到的信息"),
      }),
    },
  );

  return { retrieveTool, rerankTool, checkTool, expandTool };
}
