import { describe, it, expect } from "vitest";
import type { Profile } from "@code-style/profile";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  schemaVersion: "1.0.0",
  author: "testuser",
  generated: "2026-02-27",
  sources: ["owner/repo-a"],
  naming: {
    variables: { convention: "camelCase", confidence: 0.94, stability: "high" },
  },
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

describe("mergeProfiles", () => {
  it("keeps existing rules when new analysis has no data", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile();
    const incoming = makeProfile({
      naming: {},
    });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: true });
    expect(merged.naming.variables?.convention).toBe("camelCase");
  });

  it("updates rules when incoming has higher confidence", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.80 },
      },
    });
    const incoming = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.95 },
      },
    });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: false });
    expect(merged.naming.variables?.confidence).toBe(0.95);
  });

  it("adds new rules from incoming profile", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
      },
    });
    const incoming = makeProfile({
      naming: {
        variables: { convention: "camelCase", confidence: 0.94 },
        functions: { convention: "camelCase", confidence: 0.97 },
      },
    });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: false });
    expect(merged.naming.functions?.convention).toBe("camelCase");
    expect(merged.naming.variables?.convention).toBe("camelCase");
  });

  it("preserves overrides when keepOverrides is true", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({
      overrides: [
        {
          files: ["**/*.test.ts"],
          naming: {
            functions: { convention: "any", confidence: 1.0 },
          },
        },
      ],
    });
    const incoming = makeProfile({ overrides: [] });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: true });
    expect(merged.overrides).toHaveLength(1);
    expect(merged.overrides[0].files).toContain("**/*.test.ts");
  });

  it("merges sources from both profiles without duplicates", async () => {
    const { mergeProfiles } = await import("../commands/update.js");
    const existing = makeProfile({ sources: ["owner/repo-a"] });
    const incoming = makeProfile({ sources: ["owner/repo-a", "owner/repo-b"] });

    const merged = mergeProfiles(existing, incoming, { keepOverrides: false });
    expect(merged.sources).toEqual(["owner/repo-a", "owner/repo-b"]);
  });
});
