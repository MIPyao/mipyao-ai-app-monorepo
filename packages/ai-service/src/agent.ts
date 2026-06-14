import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";
import { SiliconFlowReranker } from "./reranker";
import { SufficiencyChecker } from "./sufficiency-checker";
import { QueryExpander } from "./query-expander";
import { QueryRewriter } from "./query-rewriter";
import { RagConfig } from "./rag.config";

export interface AgentTools {
  rewriteTool: DynamicStructuredTool;
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
  const rewriter = new QueryRewriter(llm);

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
      console.log(`   🔍 [retrieve] 搜索: "${query}"`);
      const docs = await hybridRetrieve(query, 6);
      console.log(`   📄 [retrieve] 找到 ${docs.length} 个文档:`);
      docs.forEach((doc, i) => {
        const title = doc.metadata?.document_title || "未知";
        const section = doc.metadata?.section_title || "";
        console.log(`      ${i + 1}. [${title}${section ? " - " + section : ""}] ${doc.pageContent.substring(0, 80)}...`);
      });

      return JSON.stringify({
        documentCount: docs.length,
        documents: docs.map((doc) => ({
          content: doc.pageContent,
          metadata: doc.metadata,
        })),
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
    async ({ query, documents }) => {
      const parsed = JSON.parse(documents);
      console.log(`   🎯 [rerank] 收到 ${parsed.length} 个文档，开始精排...`);
      parsed.forEach((d: { metadata?: Record<string, unknown> }, i: number) => {
        const title = d.metadata?.document_title || "未知";
        console.log(`      ${i + 1}. [${title}]`);
      });
      const docs = parsed.map(
        (d: { content: string; metadata?: Record<string, unknown> }) =>
          new Document({ pageContent: d.content, metadata: d.metadata }),
      );

      const reranked = await reranker.rerank(query, docs, 3);
      console.log(`   ✨ [rerank] 精排后保留 ${reranked.length} 个文档:`);
      reranked.forEach((d, i) => {
        const title = d.metadata?.document_title || "未知";
        console.log(`      ${i + 1}. [${title}] ${d.pageContent.substring(0, 60)}...`);
      });

      return JSON.stringify({
        documentCount: reranked.length,
        documents: reranked.map((d) => ({
          content: d.pageContent,
          metadata: d.metadata,
        })),
      });
    },
    {
      name: "rerank",
      description:
        "对检索结果进行重排序，返回最相关的 top 3 结果。",
      schema: z.object({
        query: z.string().describe("原始查询"),
        documents: z.string().describe("检索到的文档JSON数组"),
      }),
    },
  );

  const checkTool = tool(
    async ({ query, context }) => {
      console.log(`   🔎 [check] 检查信息充分性...`);
      const result = await checker.check(query, context);
      console.log(`   📊 [check] 结果: ${result.sufficient ? "✅ 充分" : "❌ 不充分 - " + result.missingInfo}`);
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
      console.log(`   🔄 [expand] 生成新查询 (缺失: ${missingInfo})`);
      const expandedQuery = await expander.expand(query, missingInfo, foundInfo);
      console.log(`   🔄 [expand] 新查询: "${expandedQuery}"`);
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

  const rewriteTool = tool(
    async ({ question }) => {
      console.log(`   🔄 [rewrite] 分析问题: "${question}"`);
      const queries = await rewriter.rewrite(question);
      console.log(`   🔄 [rewrite] 拆分为 ${queries.length} 个子查询: ${queries.map(q => `"${q}"`).join(", ")}`);
      return JSON.stringify({ queries });
    },
    {
      name: "rewrite_query",
      description:
        "将复杂问题拆分为多个子查询，用于分别检索。简单问题会直接返回原始问题。",
      schema: z.object({
        question: z.string().describe("用户原始问题"),
      }),
    },
  );

  return { rewriteTool, retrieveTool, rerankTool, checkTool, expandTool };
}
