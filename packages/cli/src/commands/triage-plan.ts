import path from "node:path";
import { detectGitToplevel } from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import { buildBundles, DEFAULT_TOKEN_CAP, type TriageBundle } from "./triage-bundle.js";
import { readAuditOutputs, selectTriageFiles, type TriageSelectOptions, type TriageSelection } from "./triage-select.js";
import type { ItemSource } from "./triage-items.js";
import { fileRoles, snapshotSource } from "./triage-source.js";

/** Planning figures from the C-96 Layer 2 plan, replaced once a measured run exists. */
export const ESTIMATE = {
  fixedInputTokens: 2_500,
  tokensPerQuestion: 60,
  outputTokensPerVerdict: 150,
  inputUsdPerMillion: 3,
  outputUsdPerMillion: 15,
} as const;

export interface TriagePlanOptions extends TriageSelectOptions {
  path: string;
  db?: string;
  auditDir?: string;
  tokenCap?: number;
}

export interface TriageEstimate {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface TriagePlan {
  snapshotId: number;
  selection: TriageSelection;
  bundles: TriageBundle[];
  skippedFiles: string[];
  estimate: TriageEstimate;
  warnings: string[];
  /** The snapshot-pinned file text and symbol spans the bundles were built from. */
  source: ItemSource;
}

export function estimateCost(bundles: readonly TriageBundle[]): TriageEstimate {
  const questions = bundles.reduce((n, b) => n + b.questions.length, 0);
  const excerpt = bundles.reduce((n, b) => n + b.tokens, 0);
  const inputTokens = bundles.length * ESTIMATE.fixedInputTokens + excerpt + questions * ESTIMATE.tokensPerQuestion;
  const outputTokens = questions * ESTIMATE.outputTokensPerVerdict;
  const costUsd = (inputTokens * ESTIMATE.inputUsdPerMillion + outputTokens * ESTIMATE.outputUsdPerMillion) / 1e6;
  return { calls: bundles.length, inputTokens, outputTokens, costUsd };
}

function latestSnapshotId(dbPath: string, store: ReturnType<typeof openGraphStore>): number {
  const snapshot = store.listSnapshots({ limit: 1 })[0];
  if (!snapshot) throw new Error(`${dbPath} has no snapshot; run \`codewatch audit\` first`);
  return snapshot.id;
}

/** Selects the files and findings to triage and builds their bundles, without calling a model. */
export function planTriage(options: TriagePlanOptions): TriagePlan {
  const root = path.resolve(options.path);
  const idRoot = detectGitToplevel(root) ?? root;
  const dbPath = path.resolve(options.db ?? path.join(root, ".codewatch", "graph.db"));
  const audit = readAuditOutputs(path.resolve(options.auditDir ?? path.join(root, ".codewatch", "audit")));
  const store = openGraphStore(dbPath);
  try {
    const snapshotId = latestSnapshotId(dbPath, store);
    const selection = selectTriageFiles(audit, fileRoles(store, snapshotId), options);
    const warnings: string[] = [];
    const source = snapshotSource(store, snapshotId, idRoot, warnings);
    const { bundles, skippedFiles } = buildBundles(selection.files, source, options.tokenCap ?? DEFAULT_TOKEN_CAP);
    const pinned: ItemSource = { lines: source.lines, symbols: source.symbols };
    return { snapshotId, selection, bundles, skippedFiles, estimate: estimateCost(bundles), warnings, source: pinned };
  } finally {
    store.close();
  }
}
