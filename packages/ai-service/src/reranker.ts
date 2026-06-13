import { Document } from "@langchain/core/documents";

interface RerankConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface RerankResult {
  index: number;
  relevance_score: number;
}

interface RerankResponse {
  results: RerankResult[];
}

export class SiliconFlowReranker {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: RerankConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
  }

  async rerank(
    query: string,
    documents: Document[],
    topN: number = 3,
  ): Promise<Document[]> {
    if (documents.length === 0) return [];
    if (documents.length <= topN) return documents;

    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: documents.map((d) => d.pageContent),
        top_n: topN,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Rerank API failed: ${response.status} - ${error}`);
    }

    const data = await response.json();

    if (!data?.results || !Array.isArray(data.results)) {
      throw new Error("Invalid rerank response: missing results array");
    }

    return data.results
      .filter((r: RerankResult) => {
        if (typeof r.index !== "number" || r.index < 0 || r.index >= documents.length) {
          console.warn(`[Reranker] Invalid index: ${r.index}, skipping`);
          return false;
        }
        return true;
      })
      .sort((a: RerankResult, b: RerankResult) => b.relevance_score - a.relevance_score)
      .map((r: RerankResult) => documents[r.index]);
  }
}