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
  openrouterConfig: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
  };
  siliconflowConfig: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
  };
}
