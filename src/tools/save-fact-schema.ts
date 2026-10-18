import { z } from "zod";
import { DOMAINS } from "../types.js";
import { loadConfig } from "../config.js";

const config = loadConfig();

export const VALUE_MAX = 2000;
export const CONTEXT_MAX = 1000;
const KEY_MAX = 200;
const PERSON_MAX = 100;

// Absorption folds later parameters into an earlier field. What identifies it is a
// field being closed and another immediately opened, so the two halves are matched
// independently rather than as whole formats: a mis-serialized call can switch style
// mid-stream, closing a field bare and opening the next as a parameter. Matching whole
// formats missed exactly that, and the write was accepted.
//
// Requiring the pair keeps most prose safe. Prose quoting a close-open pair, or ending in
// </invoke>, is still rejected; the error asks for a re-send.
const CALL_PARAMS =
  "domain|category|key|value|value_numeric|currency|unit|context|people|as_of|content|type";
const CLOSES_A_FIELD = String.raw`<\/(?:value|context|content|parameter)>`;
const OPENS_A_FIELD = String.raw`<(?:parameter\s+name=["'](?:${CALL_PARAMS})["']|(?:${CALL_PARAMS})\b)`;
const TRAILING_CALL_ARTIFACT = String.raw`(?:<\/parameter>\s*)?<\/invoke>\s*$`;

const ABSORBED_TOOL_CALL_MARKUP = new RegExp(
  `(?:${CLOSES_A_FIELD}\\s*${OPENS_A_FIELD}|${TRAILING_CALL_ARTIFACT})`
);

function withoutAbsorbedMarkup(field: string, schema: z.ZodString) {
  return schema.refine((text) => !ABSORBED_TOOL_CALL_MARKUP.test(text), {
    message: `${field} contains absorbed tool-call markup, so the call was mis-serialized and later parameters were folded into it. Re-send with each parameter separate.`,
  });
}

function toolText(field: string, max: number) {
  return withoutAbsorbedMarkup(
    field,
    z.string().max(max, `${field} exceeds ${max} characters. Put long prose in a vault markdown file.`)
  );
}

export const captureContent = withoutAbsorbedMarkup("content", z.string());

const currency = (
  config.tools.save_fact.currencies
    ? z.enum(config.tools.save_fact.currencies as [string, ...string[]])
    : toolText("currency", 32)
)
  .optional()
  .describe("Currency code (e.g. USD, EUR)");

const unit = (
  config.tools.save_fact.units
    ? z.enum(config.tools.save_fact.units as [string, ...string[]])
    : toolText("unit", 32)
)
  .optional()
  .describe("Recurrence unit (e.g. monthly, annual)");

export function exampleList(base: string, examples: string[]): string {
  return examples.length > 0 ? `${base}, e.g. '${examples.join("', '")}'` : base;
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Guards and caps only. domain/category enums stay at the MCP boundary below,
// where the env-configured lists are authoritative.
//
// The caps are the hard limit, so the descriptions say what a fact holds rather than
// setting a length budget.
const guardedFields = {
  key: toolText("key", KEY_MAX).describe(
    exampleList("Stable snake_case identifier", config.tools.save_fact.keyExamples)
  ),
  value: toolText("value", VALUE_MAX).describe(
    `The answer, readable on its own. About 400-1,000 characters together with context; ` +
      `${VALUE_MAX} is the hard cap. Longer material goes in a vault markdown file, with this ` +
      `as the answer plus the file's path.`
  ),
  value_numeric: z.number().optional().describe("Numeric value if applicable"),
  currency,
  unit,
  context: toolText("context", CONTEXT_MAX)
    .optional()
    .describe(
      `Caveats a reader needs to use the value safely: method, sample size, estimate or ` +
        `measured. ${CONTEXT_MAX} is the hard cap.`
    ),
  people: z
    .array(toolText("people entry", PERSON_MAX))
    .optional()
    .describe(config.tools.save_fact.peopleDescription),
  as_of: toolText("as_of", 32)
    .refine(isRealIsoDate, { message: "as_of must be a real date in YYYY-MM-DD format." })
    .refine((value) => value <= utcToday(), {
      message: "as_of cannot be later than the server's current UTC date.",
    })
    .optional()
    .describe("Date this fact is true as of (YYYY-MM-DD, default: today)"),
};

export const saveFactShape = {
  domain: z.enum(DOMAINS as [string, ...string[]]),
  category: z.enum(config.categories as [string, ...string[]]),
  ...guardedFields,
};

export const SaveFactCommandSchema = z.object({
  domain: toolText("domain", KEY_MAX),
  category: toolText("category", KEY_MAX),
  ...guardedFields,
});

export type SaveFactCommand = z.infer<typeof SaveFactCommandSchema>;
