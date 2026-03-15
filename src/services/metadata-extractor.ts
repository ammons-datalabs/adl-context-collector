import type { CaptureMetadata } from "../types.js";
import { DOMAINS, CAPTURE_TYPES } from "../types.js";
import { loadConfig } from "../config.js";
import { resolveApiKey } from "./resolve-api-key.js";

function buildSystemPrompt(): string {
  return `You are a metadata extraction engine. Given a text chunk from a personal knowledge base, extract structured metadata.

Return a JSON object with exactly these fields:
{
  "type": one of ${CAPTURE_TYPES.map((t) => `"${t}"`).join(", ")},
  "domain": one of ${DOMAINS.map((d) => `"${d}"`).join(", ")},
  "topics": array of 1-5 lowercase topic tags,
  "people": array of person names mentioned (use lowercase first names),
  "action_items": array of action items if any (empty array if none),
  "dates": object mapping event descriptions to ISO date strings (empty object if none)
}

Return ONLY valid JSON, no markdown or explanation.`;
}

async function attemptExtraction(
  url: string,
  headers: Record<string, string>,
  model: string,
  content: string,
  useResponseFormat: boolean
): Promise<CaptureMetadata | null> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content },
    ],
    temperature: 0,
  };
  if (useResponseFormat) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (
      useResponseFormat &&
      response.status >= 400 &&
      response.status < 500 &&
      (errText.toLowerCase().includes("response_format") ||
        errText.toLowerCase().includes("json"))
    ) {
      return attemptExtraction(url, headers, model, content, false);
    }
    throw new Error(`Metadata API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  try {
    return JSON.parse(data.choices[0].message.content) as CaptureMetadata;
  } catch {
    console.warn("Metadata extraction returned non-JSON response, skipping");
    return null;
  }
}

export async function extractMetadata(
  content: string
): Promise<CaptureMetadata | null> {
  const { metadataExtractor } = loadConfig();
  if (!metadataExtractor.enabled) return null;

  const apiKey = resolveApiKey(metadataExtractor.apiKey);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  return attemptExtraction(
    metadataExtractor.url,
    headers,
    metadataExtractor.model,
    content,
    true
  );
}
