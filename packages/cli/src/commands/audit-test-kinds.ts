import { parseSymbolId, type Finding, type GraphEdge, type GraphNode } from "@titan-design/code-graph";
import { touches, type ChangedLines } from "./audit-changed.js";
import type { MetricIndex } from "./audit-collect.js";
import { callersByCallee, citation, reachingTests, spanOf } from "./audit-graph-walk.js";
import { TEST_KIND_POLICY, type TestKindRequirement } from "./audit-rules.js";

export interface TestKindInput {
  nodes: readonly GraphNode[];
  metrics: MetricIndex;
  edges: readonly GraphEdge[];
  /** Public entry points (audit-entries.ts); only these are checked. */
  entries: ReadonlySet<string>;
  /** Lines the PR changes; an entry point they touch is checked even when no test reaches it. */
  changed?: ChangedLines;
}

/** code-graph writes every test_kind_* row on each test function, and symbol_tests_* rows only where a test reaches. */
const TEST_FUNCTION_METRIC = "test_kind_snapshot";
const REACHED_METRIC = "symbol_tests_snapshot";
const LOOSE_ONLY_METRIC = "symbol_tests_loose_output_only";
const LISTED_TESTS = 5;

interface Gap {
  requirement: TestKindRequirement;
  labels: string[];
}

export function testsLine(tests: readonly string[], nodes: ReadonlyMap<string, GraphNode>): string {
  if (tests.length === 0) return "tests: none";
  const cited = tests.map((t) => citation(t, nodes)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const more = cited.length > LISTED_TESTS ? ` (+${cited.length - LISTED_TESTS} more)` : "";
  return `tests: ${cited.slice(0, LISTED_TESTS).join(", ")}${more}`;
}

/** The requirements `id` misses across every code kind it has, one per slug, naming each kind that needs it. */
function gapsOf(id: string, metrics: MetricIndex): Gap[] {
  const gaps = new Map<string, Gap>();
  for (const policy of TEST_KIND_POLICY) {
    if (metrics.get(policy.codeKind)?.get(id) !== 1) continue;
    for (const requirement of policy.requires) {
      if (requirement.anyOf.some((m) => (metrics.get(m)?.get(id) ?? 0) > 0)) continue;
      const gap = gaps.get(requirement.slug) ?? { requirement, labels: [] };
      gap.labels.push(policy.label);
      gaps.set(requirement.slug, gap);
    }
  }
  return [...gaps.values()];
}

function evidenceOf(gap: Gap, looseOnly: boolean, tests: string): string {
  const lines = [`code kind: ${gap.labels.join(", ")}`, `missing: ${gap.requirement.missing}`, tests];
  if (looseOnly && gap.requirement.slug === "full-output") lines.push("note: its tests assert only loose output");
  return lines.join("\n");
}

function inScope(node: GraphNode, metrics: MetricIndex, changed: ChangedLines | undefined): boolean {
  if (metrics.get(REACHED_METRIC)?.has(node.id)) return true;
  const span = spanOf(node);
  const fileId = parseSymbolId(node.id)?.fileId;
  return span !== undefined && fileId !== undefined && touches(changed, fileId, span);
}

interface SymbolContext {
  nodes: ReadonlyMap<string, GraphNode>;
  callers: ReadonlyMap<string, readonly string[]>;
  isTest: (id: string) => boolean;
}

function findingsFor(node: GraphNode, metrics: MetricIndex, ctx: SymbolContext): Finding[] {
  const gaps = gapsOf(node.id, metrics);
  const parsed = parseSymbolId(node.id);
  if (gaps.length === 0 || !parsed) return [];
  const tests = testsLine(reachingTests(node.id, ctx.callers, ctx.isTest), ctx.nodes);
  const looseOnly = (metrics.get(LOOSE_ONLY_METRIC)?.get(node.id) ?? 0) > 0;
  const span = spanOf(node);
  return gaps.map((gap) => ({
    id: `codewatch:missing-test-kind:${node.id}:${gap.requirement.slug}`,
    path: parsed.fileId,
    ...(span ? { lineStart: span.start, lineEnd: span.end } : {}),
    symbol: parsed.name,
    signal: "missing-test-kind",
    severity: "warning",
    evidence: evidenceOf(gap, looseOnly, tests),
    tool: "codewatch",
  }));
}

/**
 * `missing-test-kind` findings under {@link TEST_KIND_POLICY}, on entry points only: an entry is
 * checked when a test reaches it or the PR changes it, so untested code outside the change stays
 * quiet and private or internal helpers get no per-symbol test-gap rows.
 */
export function testKindFindings(input: TestKindInput): Finding[] {
  const testFunctions = input.metrics.get(TEST_FUNCTION_METRIC) ?? new Map<string, number>();
  const ctx: SymbolContext = {
    nodes: new Map(input.nodes.map((n) => [n.id, n])),
    callers: callersByCallee(input.edges),
    isTest: (id) => testFunctions.has(id),
  };
  return input.nodes
    .filter((n) => n.kind === "symbol" && input.entries.has(n.id) && inScope(n, input.metrics, input.changed))
    .flatMap((n) => findingsFor(n, input.metrics, ctx));
}
