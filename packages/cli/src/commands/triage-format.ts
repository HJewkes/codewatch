import type { TriageBundle } from "./triage-bundle.js";
import type { TriagePlan } from "./triage-plan.js";
import { findingTarget } from "./triage-questions.js";

export interface TriageRunSettings {
  minRank: number;
  includeTests: boolean;
  budgetUsd: number;
  concurrency: number;
  model: string;
}

const kTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function reuseLine({ verdicts }: TriagePlan): string {
  const source = verdicts.from === undefined ? "no earlier snapshot holds verdicts" : `${verdicts.carried} carried from snapshot ${verdicts.from}`;
  return `${verdicts.reused.length} questions skipped for an existing verdict (${source}).`;
}

function header(plan: TriagePlan, settings: TriageRunSettings): string[] {
  const { selection, bundles } = plan;
  const questions = bundles.reduce((n, b) => n + b.questions.length, 0);
  const { belowRank, tests, unscored } = selection.excluded;
  const testNote = settings.includeTests ? "test files included" : `${tests} in test files`;
  return [
    `codewatch triage (dry run, no model calls): snapshot ${plan.snapshotId}, rank >= ${settings.minRank}, model ${settings.model}, concurrency ${settings.concurrency}`,
    `${selection.files.length} files, ${questions} questions. Left out: ${belowRank} below rank, ${testNote}, ${unscored} unscored; ${selection.ineligible} findings have no triage question.`,
    reuseLine(plan),
  ];
}

function estimateLines(plan: TriagePlan, settings: TriageRunSettings): string[] {
  const { estimate, bundles } = plan;
  const excerpt = bundles.reduce((n, b) => n + b.tokens, 0);
  const split = new Set(bundles.filter((b) => b.id !== b.path).map((b) => b.path)).size;
  const fits = estimate.costUsd <= settings.budgetUsd ? "within" : "OVER";
  return [
    `${bundles.length} bundles (${split} files split over the token cap), ~${kTokens(excerpt)} excerpt tokens.`,
    `Estimate: ${estimate.calls} calls, ~${kTokens(estimate.inputTokens)} input and ~${kTokens(estimate.outputTokens)} output tokens, ~$${estimate.costUsd.toFixed(2)} (${fits} the $${settings.budgetUsd} budget; control bundles not included).`,
  ];
}

function bundleLines(bundle: TriageBundle, rank: number | undefined): string[] {
  const head = `  ${(rank ?? 0).toFixed(1).padStart(5)}  ${bundle.id}  (${bundle.questions.length} question${bundle.questions.length === 1 ? "" : "s"}, ~${kTokens(bundle.tokens)} tokens)`;
  const questions = bundle.questions.map(
    ({ finding, question }) => `           ${finding.signal}  ${findingTarget(finding)}: ${question.text}`,
  );
  return [head, ...questions];
}

export function formatTriagePlan(plan: TriagePlan, settings: TriageRunSettings): string {
  const ranks = new Map(plan.selection.files.map((f) => [f.path, f.rank]));
  const lines = [...header(plan, settings), ...estimateLines(plan, settings), ""];
  for (const bundle of plan.bundles) lines.push(...bundleLines(bundle, ranks.get(bundle.path)));
  for (const p of plan.skippedFiles) lines.push(`  skipped  ${p}`);
  return lines.join("\n");
}
