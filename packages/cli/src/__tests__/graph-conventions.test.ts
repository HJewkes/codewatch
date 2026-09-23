import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Summarizer } from "@titan-design/code-graph";
import type { Embedder } from "@titan-design/embed";
import {
  formatConventionMapText,
  runGraphConventionsCommand,
  runGraphConventionsQuery,
} from "../commands/graph-conventions.js";
import { runGraphIndex } from "../commands/graph-index-run.js";

const A_SRC = "export function base(n: number): number {\n  return n;\n}\n";
const B_SRC = 'import { base } from "./a.js";\nexport const one = base(1);\n';
const C_SRC = 'import { base } from "./a.js";\nexport const two = base(2);\n';

const fakeSummarizer = (): Summarizer & { calls: number } => {
  const s = {
    model: "fake-summary",
    calls: 0,
    summarize(prompt: string) {
      s.calls++;
      const label = prompt.match(/^Capability area: (.+)$/m)?.[1] ?? "?";
      return Promise.resolve(`Summary of ${label}.`);
    },
  };
  return s;
};

const hashEmbedder: Embedder = {
  model: "fake-embed",
  dimensions: 8,
  embed: (texts: string[]) =>
    Promise.resolve(
      texts.map((t) => {
        const bytes = createHash("sha256").update(t, "utf8").digest();
        return Array.from(bytes.subarray(0, 8), (b) => b / 255 - 0.5);
      }),
    ),
};

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "c88-conv-"));
  mkdirSync(join(dir, "src", "util"), { recursive: true });
  writeFileSync(join(dir, "src", "util", "a.ts"), A_SRC);
  writeFileSync(join(dir, "src", "util", "b.ts"), B_SRC);
  writeFileSync(join(dir, "src", "util", "c.ts"), C_SRC);
  const result = await runGraphIndex({ rootDir: dir, ref: "test", computeChurn: false, detectRenames: false });
  dbPath = result.dbPath;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("graph conventions command", () => {
  it("summarizes cache misses, then reuses; --offline reads without an LLM", async () => {
    const summarizer = fakeSummarizer();
    const first = await runGraphConventionsCommand({ db: dbPath, summarizer });
    expect(first.newlySummarized).toBe(1);
    expect(first.areas[0].summary).toBe("Summary of src/util.");

    const offline = await runGraphConventionsCommand({ db: dbPath, summarizer, offline: true });
    expect(offline.coverage.summarized).toBe(1);
    expect(summarizer.calls).toBe(1);

    const text = formatConventionMapText(first);
    expect(text).toContain("src/util");
    expect(text).toContain("Summary of src/util.");
  });

  it("query mode ensures summaries then ranks areas", async () => {
    const summarizer = fakeSummarizer();
    const result = await runGraphConventionsQuery({
      db: dbPath,
      query: "Summary of src/util.",
      summarizer,
      embedder: hashEmbedder,
      limit: 1,
    });
    expect(summarizer.calls).toBe(0);
    expect(result.matches[0].label).toBe("src/util");
    expect(result.matches[0].score).toBeCloseTo(1, 5);
  });
});
