export interface RagConfig {
  dbConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    tableName: string;
    dimensions: number;
  };
  ollamaConfig: {
    embeddingModel: string;
    llmModel: string;
    temperature: number;
    repeatPenalty: number;
  };
}
