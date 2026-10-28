import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Finding } from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import type { ChangedLines } from "./audit-changed.js";
import { indexMetrics } from "./audit-collect.js";
import { contractFindings, type ContractSnapshot } from "./audit-contract.js";
import { runGraphIndex } from "./graph-index-run.js";

export interface ContractBase {
  ref: string;
  snapshotId: number;
}

export interface ContractBaseOptions {
  root: string;
  idRoot: string;
  dbPath: string;
  ref: string;
  onNotice: (line: string) => void;
}

/** Indexes `ref`'s tree before the head index, so the head snapshot stays the latest and reuses its files. */
export async function indexContractBase(options: ContractBaseOptions): Promise<ContractBase> {
  const { root, idRoot, dbPath, ref, onNotice } = options;
  const index = await runGraphIndex({ rootDir: root, dbPath, rev: ref, toplevel: idRoot, computeChurn: false, onNotice });
  return { ref, snapshotId: index.snapshotId };
}

function readSnapshot(dbPath: string, snapshotId: number): ContractSnapshot {
  const store = openGraphStore(dbPath);
  try {
    return {
      nodes: store.listNodes(snapshotId, { includeSymbols: true }),
      edges: store.listEdges(snapshotId, { includeReferences: true }),
      metrics: indexMetrics(store.listMetrics(snapshotId)),
    };
  } finally {
    store.close();
  }
}

function gitShow(idRoot: string, ref: string, file: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { cwd: idRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return undefined;
  }
}

function readWorkingTree(idRoot: string, file: string): string | undefined {
  try {
    return readFileSync(path.join(idRoot, file), "utf8");
  } catch {
    return undefined;
  }
}

/** Contract changes of the working tree against the indexed base. */
export function contractAudit(base: ContractBase, head: ContractSnapshot, changed: ChangedLines, dbPath: string, idRoot: string): Promise<Finding[]> {
  return contractFindings({
    base: readSnapshot(dbPath, base.snapshotId),
    head,
    changed,
    readBase: (file) => gitShow(idRoot, base.ref, file),
    readHead: (file) => readWorkingTree(idRoot, file),
  });
}
