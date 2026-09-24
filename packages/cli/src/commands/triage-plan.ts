import path from "node:path";
import { detectGitToplevel, listVerdicts, type Finding } from "@titan-design/code-graph";
import type { LineSource } from "@titan-design/evidence";
import { openGraphStore } from "../utils/graph-store.js";
import { buildBundles, DEFAULT_TOKEN_CAP, type TriageBundle } from "./triage-bundle.js";
import { readAuditOutputs, selectTriageFiles, type TriageSelectOptions, type TriageSelection } from "./triage-select.js";
import { carryPriorVerdicts, skipJudged, type ReusedVerdict, type VerdictCarry } from "./triage-persist.js";
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

/** How the verdicts already in graph.db shaped this plan. */
export interface VerdictReuse extends VerdictCarry {
  reused: ReusedVerdict[];
}

export interface TriagePlan {
  dbPath: string;
  snapshotId: number;
  selection: TriageSelection;
  bundles: TriageBundle[];
  skippedFiles: string[];
  estimate: TriageEstimate;
  warnings: string[];
  /** The snapshot-pinned file text the bundles were built from. */
  source: LineSource;
  /** Every selected finding's stored key, including the ones skipped for an existing verdict. */
  keys: ReadonlyMap<Finding, string>;
  verdicts: VerdictReuse;
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

/** Carries earlier verdicts forward, then selects the files and findings still unjudged and builds their bundles, without calling a model. */
export function planTriage(options: TriagePlanOptions): TriagePlan {
  const root = path.resolve(options.path);
  const idRoot = detectGitToplevel(root) ?? root;
  const dbPath = path.resolve(options.db ?? path.join(root, ".codewatch", "graph.db"));
  const audit = readAuditOutputs(path.resolve(options.auditDir ?? path.join(root, ".codewatch", "audit")));
  const cap = options.tokenCap ?? DEFAULT_TOKEN_CAP;
  const store = openGraphStore(dbPath);
  try {
    const snapshotId = latestSnapshotId(dbPath, store);
    const carry = carryPriorVerdicts(store, snapshotId);
    const warnings: string[] = [];
    const source = snapshotSource(store, snapshotId, idRoot, warnings);
    const selected = selectTriageFiles(audit, fileRoles(store, snapshotId), options);
    const { selection, keys, reused } = skipJudged(selected, source, listVerdicts(store, snapshotId), cap);
    const { bundles, skippedFiles } = buildBundles(selection.files, source, cap);
    const verdicts = { ...carry, reused };
    return { dbPath, snapshotId, selection, bundles, skippedFiles, estimate: estimateCost(bundles), warnings, source: { lines: source.lines }, keys, verdicts };
  } finally {
    store.close();
  }
}
