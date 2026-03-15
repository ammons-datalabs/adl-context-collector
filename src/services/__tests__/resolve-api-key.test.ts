import { describe, it, expect, vi, beforeEach } from "vitest";

describe("resolveApiKey", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null for null input", async () => {
    const { resolveApiKey } = await import("../resolve-api-key.js");
    expect(resolveApiKey(null)).toBeNull();
  });

  it("resolves env: prefix to environment variable", async () => {
    vi.stubEnv("MY_API_KEY", "sk-test-123");
    const { resolveApiKey } = await import("../resolve-api-key.js");
    expect(resolveApiKey("env:MY_API_KEY")).toBe("sk-test-123");
  });

  it("throws when env: references unset variable", async () => {
    vi.stubEnv("MY_API_KEY", "");
    const { resolveApiKey } = await import("../resolve-api-key.js");
    expect(() => resolveApiKey("env:MY_API_KEY")).toThrow("MY_API_KEY");
  });

  it("returns literal string when no env: prefix", async () => {
    const { resolveApiKey } = await import("../resolve-api-key.js");
    expect(resolveApiKey("sk-literal-key")).toBe("sk-literal-key");
  });
});
