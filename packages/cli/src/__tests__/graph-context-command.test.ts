import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { CONTEXT_SCHEMA_VERSION, renderContextMarkdown } from "@titan-design/code-graph";
import { runGraphContextCommand } from "../commands/graph-context.js";
import { runGraphIndexCommand } from "../commands/graph-index.js";

describe("graph context composed over @titan-design/code-graph", () => {
  let rootDir: string;
  let dbPath: string;

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-graph-context-"));
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "src", "a.ts"),
      "export function work(n: number): number {\n  const doubled = n * 2;\n  return doubled + 1;\n}\n",
    );
    await fs.writeFile(
      path.join(rootDir, "src", "b.ts"),
      'import { work } from "./a.js";\nexport const B = work(1);\n',
    );
    const { result } = await runGraphIndexCommand({ rootDir });
    dbPath = result.dbPath;
  });

  afterAll(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("reports the per-symbol line count on a symbol dossier", () => {
    const dossier = runGraphContextCommand("src/a.ts#work", { db: dbPath });

    expect(dossier.schemaVersion).toBe(CONTEXT_SCHEMA_VERSION);
    expect(dossier.symbol?.loc).toBe(4);
  });

  it("shows each symbol's line count in the file markdown", () => {
    const dossier = runGraphContextCommand("src/a.ts", { db: dbPath });

    expect(renderContextMarkdown(dossier)).toMatch(/\bloc\b/);
  });
});
