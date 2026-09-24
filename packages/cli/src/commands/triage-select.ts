import { readFileSync } from "node:fs";
import path from "node:path";
import type { Finding, NodeRole } from "@titan-design/code-graph";
import type { ScoreTable } from "./audit-score.js";
import { isTriageSignal } from "./triage-questions.js";

export const DEFAULT_MIN_RANK = 70;

/** Test-quality questions arrive with Tier T, so these roles stay out unless asked for. */
const TEST_ROLES: ReadonlySet<NodeRole> = new Set(["test", "fixture"]);

export interface AuditOutputs {
  findings: Finding[];
  scores: ScoreTable;
}

export interface TriageSelectOptions {
  minRank: number;
  includeTests: boolean;
}

export interface SelectedFile {
  path: string;
  rank: number;
  findings: Finding[];
}

export interface TriageSelection {
  files: SelectedFile[];
  /** Eligible findings left out, by reason. */
  excluded: { belowRank: number; tests: number; unscored: number };
  /** Findings whose signal has no triage question. */
  ineligible: number;
}

export function readAuditOutputs(auditDir: string): AuditOutputs {
  const text = readFileSync(path.join(auditDir, "findings.jsonl"), "utf8");
  const findings = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Finding);
  const scores = JSON.parse(readFileSync(path.join(auditDir, "scores.json"), "utf8")) as ScoreTable;
  return { findings, scores };
}

type Exclusion = keyof TriageSelection["excluded"];

function exclusionOf(
  rank: number | undefined,
  role: NodeRole | undefined,
  options: TriageSelectOptions,
): Exclusion | undefined {
  if (rank === undefined) return "unscored";
  if (rank < options.minRank) return "belowRank";
  if (!options.includeTests && role !== undefined && TEST_ROLES.has(role)) return "tests";
  return undefined;
}

/** Files at or above the rank threshold, each with its findings that carry a triage question, highest rank first. */
export function selectTriageFiles(
  audit: AuditOutputs,
  roles: ReadonlyMap<string, NodeRole>,
  options: TriageSelectOptions,
): TriageSelection {
  const rankByPath = new Map(audit.scores.files.map((f) => [f.path, f.rank]));
  const excluded = { belowRank: 0, tests: 0, unscored: 0 };
  const byPath = new Map<string, Finding[]>();
  const eligible = audit.findings.filter((f) => isTriageSignal(f.signal));
  for (const f of eligible) {
    const reason = exclusionOf(rankByPath.get(f.path), roles.get(f.path), options);
    if (reason) excluded[reason]++;
    else byPath.set(f.path, [...(byPath.get(f.path) ?? []), f]);
  }
  const files = [...byPath].map(([p, findings]) => ({ path: p, rank: rankByPath.get(p)!, findings }));
  files.sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path));
  return { files, excluded, ineligible: audit.findings.length - eligible.length };
}
