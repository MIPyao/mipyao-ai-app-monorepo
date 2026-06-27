import { ChatOpenAI } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";
import { SiliconFlowReranker } from "./reranker";
import { SufficiencyChecker } from "./sufficiency-checker";
import { QueryExpander } from "./query-expander";
import { QueryRewriter } from "./query-rewriter";
import { RagConfig } from "./rag.config";

/**
 * RAG 各阶段的纯逻辑依赖。
 *
 * 这些是供 StateGraph 节点直接调用的纯 async 函数/类实例，
 * 与 LangChain tool 包装完全解耦——节点间通过 state 传递结构化对象，
 * 不再需要 tool 包装里的 JSON.stringify/JSON.parse 序列化层。
 */
export interface RagDeps {
  rewriter: QueryRewriter;
  /** 混合检索（向量相似度 + 元数据匹配），输入查询返回 top-k 文档 */
  hybridRetrieve: (query: string, k?: number) => Promise<Document[]>;
  reranker: SiliconFlowReranker;
  checker: SufficiencyChecker;
  expander: QueryExpander;
  llm: ChatOpenAI;
}

// 从查询中提取关键词（向量检索元数据匹配用）
function extractQueryKeywords(query: string): string[] {
  const keywords: string[] = [];
  const chineseWords = query.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  keywords.push(...chineseWords);
  const englishWords = query.match(/[A-Za-z]{3,}/g) || [];
  keywords.push(...englishWords.map((w) => w.toLowerCase()));
  return keywords;
}

// 计算文档的元数据匹配分数
function calculateMetadataScore(doc: Document, queryKeywords: string[]): number {
  if (queryKeywords.length === 0) return 0.5;
  const documentTitle = (doc.metadata?.document_title || "").toLowerCase();
  const sectionTitle = (doc.metadata?.section_title || "").toLowerCase();
  let totalScore = 0;
  for (const keyword of queryKeywords) {
    const lowerKeyword = keyword.toLowerCase();
    if (documentTitle.includes(lowerKeyword)) totalScore += 1.0;
    if (sectionTitle.includes(lowerKeyword)) totalScore += 0.6;
  }
  const maxPossibleScore = queryKeywords.length * 1.6;
  return maxPossibleScore > 0 ? Math.min(totalScore / maxPossibleScore, 1.0) : 0.5;
}

// 融合检索：向量相似度 + 元数据匹配（闭包→模块作用域，供 graph 节点调用）
async function hybridRetrieve(
  vectorStore: PGVectorStore,
  query: string,
  k: number = 6,
): Promise<Document[]> {
  const vectorResults = await vectorStore.similaritySearchWithScore(query, k * 2);
  const queryKeywords = extractQueryKeywords(query);
  console.log(`      🔑 关键词: ${queryKeywords.join(", ")}`);

  const scoredDocs = vectorResults.map(([doc, distance]) => {
    const metadataScore = calculateMetadataScore(doc, queryKeywords);
    const vectorSimilarity = 1 - distance;
    const hybridScore = vectorSimilarity * 0.6 + metadataScore * 0.4;
    const title = doc.metadata?.document_title || "未知";
    console.log(`      📊 [${title}] 向量: ${vectorSimilarity.toFixed(3)} × 0.6 + 元数据: ${metadataScore.toFixed(3)} × 0.4 = ${hybridScore.toFixed(3)}`);
    return { doc, score: hybridScore };
  });

  return scoredDocs
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((item) => item.doc);
}

/**
 * 构造 RAG 各阶段的纯逻辑依赖。
 *
 * @param config 配置（含 SiliconFlow API key 等）
 * @param vectorStore 已初始化的向量库
 * @param llm 已初始化的 LLM（各阶段共享，避免重复实例化）
 */
export function createRagDeps(
  config: RagConfig,
  vectorStore: PGVectorStore,
  llm: ChatOpenAI,
): RagDeps {
  const reranker = new SiliconFlowReranker({
    apiKey: config.siliconflowConfig.apiKey,
    baseUrl: config.siliconflowConfig.baseUrl,
    model: config.siliconflowConfig.rerankModel,
  });

  const checker = new SufficiencyChecker(llm);
  const expander = new QueryExpander(llm);
  const rewriter = new QueryRewriter(llm);

  return {
    rewriter,
    hybridRetrieve: (query: string, k?: number) => hybridRetrieve(vectorStore, query, k ?? 6),
    reranker,
    checker,
    expander,
    llm,
  };
}
