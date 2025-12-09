// config/llmConfig.js
import dotenv from "dotenv";
dotenv.config();

export const LLM_CONFIG = {
  provider: process.env.LLM_PROVIDER || "openrouter",
  apiKey: process.env.LLM_API_KEY,
  baseUrl: (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  ),
  model: process.env.LLM_MODEL || "google/gemma-2-9b-it",
};
