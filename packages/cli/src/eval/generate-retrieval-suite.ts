import { writeFileSync } from "node:fs";
import { openDatabase } from "@codewatch/graph";
import { generateRetrievalSuite } from "./retrieval.js";

/**
 * Standalone runner (C-82): generate the retrieval suite from a graph.db and
 * write it as JSON. Deterministic — same db in → identical file out. Run with:
 *   tsx packages/cli/src/eval/generate-retrieval-suite.ts --db <db> --out <json> [--cap N]
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function main(): void {
  const dbPath = arg("db", "./.codewatch/graph.db")!;
  const out = arg("out");
  const cap = arg("cap");
  const db = openDatabase(dbPath);
  try {
    const suite = generateRetrievalSuite(db, { cap: cap ? Number(cap) : undefined });
    const json = JSON.stringify(suite, null, 2);
    if (out) writeFileSync(out, json + "\n");
    process.stderr.write(
      `retrieval suite: ${suite.counts.total} tasks | relevantByStratum ${JSON.stringify(suite.counts.relevantByStratum)}\n`,
    );
    if (!out) process.stdout.write(json + "\n");
  } finally {
    db.close();
  }
}

main();
