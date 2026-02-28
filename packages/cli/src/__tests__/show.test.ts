import { describe, it, expect } from "vitest";
import { formatProfileText, formatProfileJson } from "../commands/show.js";
import type { Profile } from "@code-style/profile";

const sampleProfile: Profile = {
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: ["testuser/repo-a"],
  naming: {
    variables: {
      convention: "camelCase",
      confidence: 0.94,
      stability: "high",
      fixability: "maybe-incorrect",
      description: "Use camelCase for all local variables.",
      examples: [],
    },
    functions: {
      convention: "camelCase",
      confidence: 0.97,
      stability: "high",
    },
    types: {
      convention: "PascalCase",
      confidence: 0.99,
      stability: "high",
    },
  },
  structure: {
    importOrder: {
      convention: ["builtin", "external", "internal", "relative"],
      confidence: 0.91,
      fixability: "safe",
    },
  },
  documentation: {},
  errorHandling: {},
  formatting: {
    semicolons: {
      convention: true,
      confidence: 0.99,
      stability: "high",
      fixability: "safe",
    },
  },
  patterns: {},
  idioms: { detected: [] },
  antiPatterns: { acknowledged: [] },
  overrides: [],
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
};

describe("formatProfileText", () => {
  it("includes author and generation date", () => {
    const output = formatProfileText(sampleProfile);
    expect(output).toContain("testuser");
    expect(output).toContain("2026-02-27");
  });

  it("displays all categories when no filter is provided", () => {
    const output = formatProfileText(sampleProfile);
    expect(output).toContain("naming");
    expect(output).toContain("structure");
    expect(output).toContain("formatting");
  });

  it("filters to a single category when category is provided", () => {
    const output = formatProfileText(sampleProfile, "naming");
    expect(output).toContain("naming");
    expect(output).not.toContain("structure");
    expect(output).not.toContain("formatting");
  });

  it("shows confidence as a severity indicator", () => {
    const output = formatProfileText(sampleProfile);
    expect(output).toMatch(/error/i);
  });

  it("throws for an unknown category filter", () => {
    expect(() => formatProfileText(sampleProfile, "nonexistent")).toThrow(
      /unknown category/i,
    );
  });
});

describe("formatProfileJson", () => {
  it("returns valid JSON string of entire profile", () => {
    const json = formatProfileJson(sampleProfile);
    const parsed = JSON.parse(json);
    expect(parsed.author).toBe("testuser");
  });

  it("returns only the requested category when filtered", () => {
    const json = formatProfileJson(sampleProfile, "naming");
    const parsed = JSON.parse(json);
    expect(parsed.variables).toBeDefined();
    expect(parsed.importOrder).toBeUndefined();
  });
});
