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
  geminiConfig: {
    apiKey: string;
    embeddingModel: string;
    llmModel: string;
    temperature: number;
  };
}
