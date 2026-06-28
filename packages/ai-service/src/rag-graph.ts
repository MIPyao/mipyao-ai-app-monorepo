import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { Document } from "@langchain/core/documents";
import type { Readable } from "stream";
import type { ChatOpenAI } from "@langchain/openai";
import type { SufficiencyResult } from "./sufficiency-checker";
import type { RagDeps } from "./agent";

/**
 * StateGraph 实现的 Agentic RAG 流程图。
 *
 * 相比旧的 ReAct 模式（靠 system prompt 祈祷 LLM 按序调用工具），
 * 这里用显式的图拓扑 + 条件边硬保证流程顺序：
 *
 *   rewrite → retrieve → rerank → check ─(充分/到上限)→ generate → END
 *                                      └─(不充分)→ expand →(回到 retrieve)
 *
 * 每个节点把进度通过对外 Readable 流以 `[STATUS] xxx\n` 形式推送，
 * generate 节点把最终答案逐 token 推流——这套字节契约与前端约定一致。
 */

/** 检索迭代上限（额外检索轮数，不含第 1 轮） */
export const MAX_ITERATIONS = 2;

/** generate 节点的系统提示：只保留"以赵耀口吻忠实回答"的要求，流程已由图保证 */
const GENERATE_SYSTEM_PROMPT = `你是一个专业的简历问答助手。请根据提供的"上下文"，以"赵耀"的口吻（第一人称）回答用户问题。

规则：
1. 答案中的所有信息必须能从上下文中找到，绝不允许添加、推测或编造。
2. 如果上下文不足以回答，诚实说明"我无法从提供的简历信息中找到确切答案"，不要编造。
3. 保留上下文中的 Markdown 格式，使用简洁专业的语言。`;

/** 对外流推送的状态文案（沿用前端约定的中文 + emoji 风格） */
const STATUS = {
  rewrite: "正在拆分问题...",
  retrieve: "正在检索相关信息...",
  rerank: "正在精排文档...",
  check: "正在检查信息充分性...",
  expand: "正在扩展查询...",
} as const;

/**
 * RAG 图的状态定义。
 * documents 用"覆盖"reducer：每轮 retrieve 负责合并上一轮精排文档和新检索文档，
 * rerank 输出的 top-N 直接覆盖 state，落选文档不再残留。
 */
const RagState = Annotation.Root({
  query: Annotation<string>,
  subQueries: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  documents: Annotation<Document[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  sufficiency: Annotation<SufficiencyResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  iteration: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
});

/** RagState 的类型别名，供节点函数签名使用 */
type RagStateType = typeof RagState.State;

/** 把文档列表格式化成给 LLM 看的上下文字符串 */
function formatContext(docs: Document[]): string {
  return docs
    .map((doc, i) => {
      const title = doc.metadata?.document_title || "未知";
      const section = doc.metadata?.section_title || "";
      const heading = section ? `[${title} - ${section}]` : `[${title}]`;
      return `${heading}\n${doc.pageContent}`;
    })
    .join("\n\n---\n\n");
}

// ============================================================
// 节点函数
// ============================================================

/** 第一步：把用户问题拆成子查询 */
async function rewriteNode(
  state: RagStateType,
  deps: RagDeps,
  stream: Readable,
): Promise<Partial<RagStateType>> {
  pushStatus(stream, STATUS.rewrite);
  console.log(`   🔄 [rewrite] 分析问题: "${state.query}"`);
  const queries = await deps.rewriter.rewrite(state.query);
  console.log(`   🔄 [rewrite] 拆分为 ${queries.length} 个子查询: ${queries.map((q) => `"${q}"`).join(", ")}`);
  return { subQueries: queries };
}

/** 第二步：对每个子查询分别混合检索，合并上一轮精排文档（去重）后覆盖 state */
async function retrieveNode(
  state: RagStateType,
  deps: RagDeps,
  stream: Readable,
): Promise<Partial<RagStateType>> {
  pushStatus(stream, STATUS.retrieve);
  const queries = state.subQueries.length > 0 ? state.subQueries : [state.query];
  const newDocs: Document[] = [];
  for (const q of queries) {
    console.log(`   🔍 [retrieve] 搜索: "${q}"`);
    const docs = await deps.hybridRetrieve(q, 6);
    console.log(`   📄 [retrieve] "${q}" 找到 ${docs.length} 个文档`);
    docs.forEach((doc, i) => {
      const title = doc.metadata?.document_title || "未知";
      const section = doc.metadata?.section_title || "";
      console.log(`      ${i + 1}. [${title}${section ? " - " + section : ""}] ${doc.pageContent.substring(0, 80)}...`);
    });
    newDocs.push(...docs);
  }
  // 合并上一轮精排的文档 + 本轮新检索的文档，按 pageContent 去重
  const seen = new Set<string>();
  const merged: Document[] = [];
  for (const doc of [...state.documents, ...newDocs]) {
    const key = doc.pageContent.trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(doc);
    }
  }
  // iteration 仅在第 1 轮初始化为 1，后续由 expand 节点递增
  const iteration = state.iteration === 0 ? 1 : state.iteration;
  return { documents: merged, iteration };
}

/** 第三步：对累积的文档精排，取 top 3 */
async function rerankNode(
  state: RagStateType,
  deps: RagDeps,
  stream: Readable,
): Promise<Partial<RagStateType>> {
  pushStatus(stream, STATUS.rerank);
  console.log(`   🎯 [rerank] 收到 ${state.documents.length} 个文档，开始精排...`);
  state.documents.forEach((d, i) => {
    const title = d.metadata?.document_title || "未知";
    console.log(`      ${i + 1}. [${title}]`);
  });

  const reranked = await deps.reranker.rerank(state.query, state.documents, 3);
  console.log(`   ✨ [rerank] 精排后保留 ${reranked.length} 个文档:`);
  reranked.forEach((d, i) => {
    const title = d.metadata?.document_title || "未知";
    console.log(`      ${i + 1}. [${title}] ${d.pageContent.substring(0, 60)}...`);
  });
  // top-N 直接覆盖 state，落选文档不再残留
  return { documents: reranked };
}

/** 第四步：基于中间草稿检查信息充分性 */
async function checkNode(
  state: RagStateType,
  deps: RagDeps,
  stream: Readable,
): Promise<Partial<RagStateType>> {
  pushStatus(stream, STATUS.check);
  console.log(`   🔎 [check] 检查信息充分性（基于中间草稿）...`);
  const context = formatContext(state.documents);
  const result = await deps.checker.check(state.query, context);
  const draftPreview = (result.draft || "(空)").replace(/\s+/g, " ").slice(0, 120);
  console.log(`   📝 [check] 草稿: ${draftPreview}${result.draft && result.draft.length > 120 ? "..." : ""}`);
  if (result.sufficient) {
    console.log(`   📊 [check] ✅ 充分`);
  } else {
    console.log(`   📊 [check] ❌ 不充分，缺失检索词: ${result.missingInfo.join(" / ") || "(无)"}`);
  }
  return { sufficiency: result };
}

/** 第二轮（迭代补全）：根据缺失关键词生成定向查询，覆盖 subQueries 并递增 iteration */
async function expandNode(
  state: RagStateType,
  deps: RagDeps,
  stream: Readable,
): Promise<Partial<RagStateType>> {
  pushStatus(stream, STATUS.expand);
  const missingInfo = state.sufficiency?.missingInfo ?? [];
  const context = formatContext(state.documents);
  console.log(`   🔄 [expand] 生成新查询 (缺失: ${missingInfo.join(" / ")})`);
  const expandedQueries = await deps.expander.expand(state.query, missingInfo, context);
  console.log(`   🔄 [expand] 新查询: ${expandedQueries.map((q) => `"${q}"`).join(", ")}`);
  return {
    subQueries: expandedQueries.length > 0 ? expandedQueries : [state.query],
    iteration: state.iteration + 1,
  };
}

/** 第五步：基于充分上下文生成最终答案，逐 token 推流 */
async function generateNode(
  state: RagStateType,
  llm: ChatOpenAI,
  stream: Readable,
): Promise<Partial<RagStateType>> {
  const context = formatContext(state.documents);
  const messages = [
    { role: "system", content: GENERATE_SYSTEM_PROMPT },
    { role: "user", content: `用户问题:\n${state.query}\n\n检索到的上下文:\n${context}` },
  ];

  console.log(`   ✍️ [generate] 生成最终回答...`);
  // 逐 token 推流：每个 chunk 的文本增量直接 push 给前端
  for await (const chunk of await llm.stream(messages)) {
    const text = typeof chunk.content === "string"
      ? chunk.content
      : "";
    if (text) {
      stream.push(text);
    }
  }
  console.log(`   ✅ [generate] 回答生成完毕`);
  return {};
}

/** check 节点后的条件分支：充分或达到迭代上限 → 生成，否则 → 扩展重检 */
function routeAfterCheck(state: RagStateType): "generate" | "expand" {
  const sufficient = state.sufficiency?.sufficient ?? false;
  const reachedLimit = state.iteration > MAX_ITERATIONS;
  if (sufficient || reachedLimit) {
    if (reachedLimit && !sufficient) {
      console.log(`   ⚠️ [route] 已达迭代上限 (${MAX_ITERATIONS})，转去生成（可能信息不全）`);
    } else {
      console.log(`   ➡️ [route] 信息充分，转去生成`);
    }
    return "generate";
  }
  console.log(`   🔁 [route] 信息不充分，开始第 ${state.iteration + 1} 轮检索`);
  return "expand";
}

/** 向对外流推送一条状态行（带换行，前端按行解析） */
function pushStatus(stream: Readable, status: string): void {
  stream.push(`[STATUS] ${status}\n`);
}

// ============================================================
// 图构造
// ============================================================

/**
 * 构造并编译 RAG StateGraph。
 * 返回类型由 graph.compile() 自动推断（CompiledStateGraph 的完整泛型签名较长）。
 *
 * @param deps RAG 各阶段纯逻辑依赖
 * @param stream 对外 Readable 流，节点把状态和答案推送至此
 */
export function createRagGraph(
  deps: RagDeps,
  stream: Readable,
) {
  const graph = new StateGraph(RagState)
    .addNode("rewrite", async (state: RagStateType) => rewriteNode(state, deps, stream))
    .addNode("retrieve", async (state: RagStateType) => retrieveNode(state, deps, stream))
    .addNode("rerank", async (state: RagStateType) => rerankNode(state, deps, stream))
    .addNode("check", async (state: RagStateType) => checkNode(state, deps, stream))
    .addNode("expand", async (state: RagStateType) => expandNode(state, deps, stream))
    .addNode("generate", async (state: RagStateType) => generateNode(state, deps.llm, stream));

  // 顺序边
  graph.addEdge(START, "rewrite");
  graph.addEdge("rewrite", "retrieve");
  graph.addEdge("retrieve", "rerank");
  graph.addEdge("rerank", "check");
  graph.addEdge("expand", "retrieve");
  graph.addEdge("generate", END);

  // check 后的条件分支：充分/到上限 → generate，否则 → expand
  graph.addConditionalEdges("check", routeAfterCheck, {
    generate: "generate",
    expand: "expand",
  });

  return graph.compile();
}
