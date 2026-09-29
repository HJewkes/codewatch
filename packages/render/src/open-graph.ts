import { existsSync } from "node:fs";
import { openCodeGraph, type CodeGraphStore } from "@titan-design/code-graph";

/** Open an existing graph for reading; openCodeGraph would create an empty one. */
export function openExistingGraph(dbPath: string): CodeGraphStore {
  if (!existsSync(dbPath)) {
    throw new Error(`no graph.db at ${dbPath}; run codewatch graph index`);
  }
  return openCodeGraph(dbPath);
}
