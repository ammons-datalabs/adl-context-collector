import { describe, it, expect } from "vitest";
import { domainArgDescription } from "../tools/search-context.js";

describe("domainArgDescription", () => {
  it("describes a filter when no boost is configured", () => {
    const text = domainArgDescription(0);
    expect(text).toContain("Filter");
    expect(text).not.toMatch(/rank/i);
  });

  it("describes ranking when a boost is configured", () => {
    const text = domainArgDescription(0.05);
    expect(text).toMatch(/rank/i);
    expect(text).not.toMatch(/^Filter/);
  });

  it("says facts are still filtered, since only captures are ranked", () => {
    expect(domainArgDescription(0.05)).toMatch(/fact/i);
  });

  it("never mentions domain_boost, which the caller cannot read", () => {
    expect(domainArgDescription(0)).not.toContain("domain_boost");
    expect(domainArgDescription(0.05)).not.toContain("domain_boost");
  });
});
