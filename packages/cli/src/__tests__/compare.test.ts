import { describe, it, expect } from "vitest";
import type { Profile } from "@code-style/profile";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: [],
  naming: {},
  structure: {},
  documentation: {},
  errorHandling: {},
  formatting: {},
  patterns: {},
  idioms: { detected: [] },
  antiPatterns: { acknowledged: [] },
  overrides: [],
  severityThresholds: { error: 0.85, warn: 0.60, info: 0.40 },
  ...overrides,
});

describe("compareProfiles", () => {
  it("detects added rules in right profile", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({ naming: {} });
    const right = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });

    const diffs = compareProfiles(left, right);
    const added = diffs.filter((d) => d.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].path).toBe("naming.variables");
  });

  it("detects removed rules in right profile", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });
    const right = makeProfile({ naming: {} });

    const diffs = compareProfiles(left, right);
    const removed = diffs.filter((d) => d.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].path).toBe("naming.variables");
  });

  it("detects changed conventions", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });
    const right = makeProfile({
      naming: {
        variables: { convention: "snake_case", confidence: 0.88 },
      },
    });

    const diffs = compareProfiles(left, right);
    const changed = diffs.filter((d) => d.type === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].left).toContain("camelCase");
    expect(changed[0].right).toContain("snake_case");
  });

  it("detects confidence changes", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const left = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.80 },
      },
    });
    const right = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.95 },
      },
    });

    const diffs = compareProfiles(left, right);
    const changed = diffs.filter((d) => d.type === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].path).toBe("naming.variables");
  });

  it("returns empty array when profiles are identical", async () => {
    const { compareProfiles } = await import("../commands/compare.js");
    const profile = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });

    const diffs = compareProfiles(profile, profile);
    expect(diffs).toHaveLength(0);
  });
});

describe("formatComparison", () => {
  it("formats added rules with + prefix", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const diffs = [
      { type: "added" as const, path: "naming.variables", left: "", right: "camelCase (94%)" },
    ];
    const output = formatComparison(diffs);
    expect(output).toContain("+");
    expect(output).toContain("naming.variables");
  });

  it("formats removed rules with - prefix", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const diffs = [
      { type: "removed" as const, path: "naming.variables", left: "camelCase (94%)", right: "" },
    ];
    const output = formatComparison(diffs);
    expect(output).toContain("-");
    expect(output).toContain("naming.variables");
  });

  it("formats changed rules showing both values", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const diffs = [
      { type: "changed" as const, path: "naming.variables", left: "camelCase (80%)", right: "camelCase (95%)" },
    ];
    const output = formatComparison(diffs);
    expect(output).toContain("naming.variables");
    expect(output).toContain("80%");
    expect(output).toContain("95%");
  });

  it("returns no-differences message for empty diffs", async () => {
    const { formatComparison } = await import("../commands/compare.js");
    const output = formatComparison([]);
    expect(output).toMatch(/no differences|identical/i);
  });
});
