import { loadConfig } from "../config.js";
import { resolveApiKey } from "./resolve-api-key.js";

export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedder } = loadConfig();
  const apiKey = resolveApiKey(embedder.apiKey);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(embedder.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: embedder.model, input: text }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}
