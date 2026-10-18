import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// save-fact-schema.ts calls loadConfig() at module scope, and loadConfig now refuses to
// run without COLLECTOR_CONFIG rather than defaulting to the remote provider. An empty
// config file gives it the built-in defaults, which is all this suite needs.
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
const cfgDir = join(tmpdir(), `save-fact-schema-test-${Date.now()}`);
mkdirSync(cfgDir, { recursive: true });
const cfgPath = join(cfgDir, "config.json");
writeFileSync(cfgPath, "{}");
vi.stubEnv("COLLECTOR_CONFIG", cfgPath);

const { saveFactShape, SaveFactCommandSchema, captureContent } = await import("../save-fact-schema.js");

// What the MCP SDK validates against: it parses tool input with the registered shape.
const registered = z.object(saveFactShape);

const ABSORBED_PARAMETER = '</parameter>\n<parameter name="context">swallowed';
const ABSORBED_VALUE = '</value>\n<context>swallowed</context>';
const ABSORBED_CONTEXT = '</context><people>["example-person"]</people></invoke>';
// A mis-serialized call can switch style mid-stream: a bare closing tag followed by a
// parameter-style opening one, which matching whole formats let through.
const ABSORBED_MIXED = '</value>\n<parameter name="context">swallowed';

const valid = {
  domain: "project",
  category: "status",
  key: "some_key",
  value: "clean",
};

describe("save_fact registered schema", () => {
  it("accepts a well-formed command", () => {
    expect(registered.safeParse(valid).success).toBe(true);
  });

  it("rejects absorbed parameter tags", () => {
    expect(
      registered.safeParse({ ...valid, value: `real${ABSORBED_PARAMETER}` }).success,
    ).toBe(false);
  });

  it.each([
    ["value wrapper", { value: `real${ABSORBED_VALUE}` }],
    ["context wrapper", { context: `real${ABSORBED_CONTEXT}` }],
    ["trailing invocation", { value: "real content.</invoke>" }],
  ])("rejects absorbed %s markup", (_name, fields) => {
    expect(registered.safeParse({ ...valid, ...fields }).success).toBe(false);
  });

  it.each([
    ["value closed then a parameter opened", { value: `real${ABSORBED_MIXED}` }],
    ["context closed then a parameter opened", { context: '</context>\n<parameter name="as_of">' }],
  ])("rejects mixed-style absorption: %s", (_name, fields) => {
    expect(registered.safeParse({ ...valid, ...fields }).success).toBe(false);
  });

  it.each([
    ["a single closing tag", "the call emits </value> as text and folds later parameters in"],
    ["a single opening tag", 'absorption starts at <parameter name="context"> and runs on'],
    ["an escaped example", "write &lt;/value&gt; when documenting the failure"],
  ])("accepts prose citing %s, which is how the failure gets written up", (_name, value) => {
    expect(registered.safeParse({ ...valid, value }).success).toBe(true);
  });

  it("names the offending field in the error", () => {
    const result = registered.safeParse({ ...valid, context: `real${ABSORBED_PARAMETER}` });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["context"]);
    }
  });

  it("rejects a category outside the configured list", () => {
    expect(registered.safeParse({ ...valid, category: "not-a-category" }).success).toBe(false);
  });

  it.each(["2026/09/04", "2026-02-30", "2999-01-01"])(
    "rejects invalid or future as_of date %s",
    (as_of) => {
      expect(registered.safeParse({ ...valid, as_of }).success).toBe(false);
    },
  );

  it("rejects a value over the cap", () => {
    expect(registered.safeParse({ ...valid, value: "x".repeat(2001) }).success).toBe(false);
  });

  it("rejects a trailing call artifact on the internal path", () => {
    const result = SaveFactCommandSchema.safeParse({
      ...valid,
      value: "real content.</parameter>\n</invoke>\n",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mid-string absorption followed by a trailing invocation", () => {
    expect(
      SaveFactCommandSchema.safeParse({
        ...valid,
        value: `real${ABSORBED_PARAMETER}</invoke>`,
      }).success,
    ).toBe(false);
  });

  it("shares one definition with the command schema used inside saveFact", () => {
    expect(
      SaveFactCommandSchema.safeParse({
        ...valid,
        value: `real${ABSORBED_PARAMETER}`,
      }).success,
    ).toBe(false);
  });
});

describe("capture_thought content", () => {
  it("rejects the absorbed form seen on live captures", () => {
    expect(captureContent.safeParse('note</content>\n<parameter name="type">decision').success).toBe(false);
  });

  it("accepts long plain content, since captures have no length cap", () => {
    expect(captureContent.safeParse("x".repeat(5000)).success).toBe(true);
  });
});

describe("currency and unit with configured lists", () => {
  // The enum already lists the allowed values; fixed examples could name one it rejects.
  it("describes them without examples the list may not contain", async () => {
    vi.resetModules();
    const enumCfg = join(cfgDir, "enum-config.json");
    writeFileSync(enumCfg, JSON.stringify({ tools: { save_fact: { currencies: ["AUD"], units: ["weekly"] } } }));
    vi.stubEnv("COLLECTOR_CONFIG", enumCfg);
    const { saveFactShape: shape } = await import("../save-fact-schema.js");

    expect(shape.currency.description).toBe("Currency code");
    expect(shape.unit.description).toBe("Recurrence unit");
  });
});
