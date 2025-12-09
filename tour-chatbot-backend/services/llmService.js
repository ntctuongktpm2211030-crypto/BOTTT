// services/llmService.js
import { LLM_CONFIG } from "../config/llmConfig.js";

export async function callLLMChat({ system, user }) {
  const { provider, apiKey, baseUrl, model } = LLM_CONFIG;

  if (!apiKey) {
    throw new Error("Thiếu LLM_API_KEY, không gọi được LLM.");
  }

  const url = `${baseUrl}/chat/completions`;

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.APP_PUBLIC_URL || "http://localhost:5173";
    headers["X-Title"] = "Tour Recommendation Chatbot";
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    const error = new Error(`LLM API error: ${resp.status} ${resp.statusText}`);
    error.status = resp.status;
    error.rawBody = errBody;
    console.error("⚠️ LLM error body:", errBody);
    throw error;
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content;
  return reply || "Xin lỗi, mình chưa trả lời được câu hỏi này.";
}
