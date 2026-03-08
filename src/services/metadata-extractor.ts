import type { CaptureMetadata } from "../types.js";
import { DOMAINS, CAPTURE_TYPES } from "../types.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

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

export async function extractMetadata(
  content: string
): Promise<CaptureMetadata> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Metadata API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return JSON.parse(data.choices[0].message.content) as CaptureMetadata;
}
