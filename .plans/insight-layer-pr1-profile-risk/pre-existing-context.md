# Pre-Existing Context

Plan: insight-layer-pr1-profile-risk

## Coverage Assessment

- Codebase review: yes
- External research: no
- Requirements: yes
- Skip research: no

## Gathered Context

### Brain Note: codewatch-insight-layer-design-brief-file-first-profile-risk

---
id: codewatch-insight-layer-design-brief-file-first-profile-risk
title: "codewatch insight layer — design brief (file-first profile + risk)"
type: decision
tier: slow
tags: [codewatch, design, reporting, risk-score, profile, M43]
summary: "Three-layer artifact suite (substrate → insight → artifact) for codewatch reporting. File-first build: Profile + RiskScore service, then L2 file pages, then PR overlay. Bus-factor removed from risk recipe (agentic-coding context); fan-in added."
created: 2026-05-12
modified: 2026-05-12
---

# codewatch insight layer — design brief (file-first profile + risk)

# codewatch insight layer — design brief (2026-05-12)

Locked design for the next reporting milestone in codewatch. File-first build, rollups deferred.

## Problem
Codewatch has substantial substrate (graph + metrics + churn + LCOM + roles + PageRank) but no organizing layer between raw facts and human/agent-readable artifacts. Each existing report (`graph report`, `graph wiki`, `graph relevant`, `graph check`) queries the substrate independently and renders its own ribbon. There's no shared interpretation. The two consequences:

1. Metric → insight gap. `lcom4_max=9` is a fact. "This file is risky because of LCOM + churn + complexity-peak combined" is the insight. Today's surfaces don't compose them.
2. No file-level zoom. We have L1 (per-package wiki) and L0 (global report) but no L2 (per-file). Per-file is the unit consumed in code review and by agents working a change — the highest-leverage artifact.

## Structure

Three layers:

```
Artifact layer:   L0 system map · L1 domain wiki · L2 file page · PR overlay
                  Markdown for humans, JSON for agents (same data, different ribbon)
                                ↑ reads
Insight layer:    Profile<Node> · RiskScore · DomainCluster · Summary · Recommendation
                                ↑ reads
Substrate layer:  Graph nodes + edges + metrics + git data (today)
                  Future: symbol nodes + call edges + role/seam tags
```

Three principles:
- **Single source of truth.** Every artifact reads the same `Profile + RiskScore`. Fix scoring once, every artifact updates.
- **Zoom coherence.** Same concept appears at every level, aggregated appropriately. Risk-of-file → risk-of-domain → risk-of-system, never different metrics.
- **PR overlay is a mode, not a parallel pipeline.** Every artifact gets `--vs <ref>` for diff view.

## Data model (PR #1 — Profile + RiskScore service)

```ts
// profile.ts
export interface FileProfile {
  id: string;
  package: { id: string; name: string } | null;
  role: NodeRole | null;
  size: { loc: number; functionCount: number; classCount: number };
  complexity: {
    cognitiveMax: number; cognitiveSum: number;
    cyclomaticMax: number; cyclomaticSum: number;
    maxNestingDepth: number; lcom4Max: number | null;
  };
  linkage: {
    fanIn: number; fanOut: number; instability: number;
    pageRankPercentile: number;
    inboundEdges: Array<{ src: string; kind: EdgeKind }>;
    outboundEdges: Array<{ dst: string; kind: EdgeKind; crossPackage: boolean }>;
    coupling: Array<{ peer: string; count: number }>;
  };
  ownership: { busFactor: number; topAuthor: string | null; topAuthorShare: number; distinctAuthors: number };
  activity: { churnLines: number; churnCommits: number; windowDays: number };
  summary: string;
}

export function assembleFileProfile(
  snapshotId: number, fileId: string, ctx: AssembleCtx
): FileProfile;

// risk.ts
export interface RiskFactor {
  key: "hotspot" | "complexity_peak" | "high_fanout" | "high_fanin" | "cohesion" | "recency";
  weight: number;          // 0..100 contribution
  detail: string;          // evidence
  severity: "info" | "warn" | "alert";
}

export interface RiskScore {
  score: number;           // 0..100
  band: "healthy" | "watch" | "elevated" | "urgent";
  factors: RiskFactor[];   // sorted desc; explains the score
}

export function computeRiskScore(profile: FileProfile): RiskScore;
```

## RiskScore recipe v1 (opinionated; configurability deferred)

| Factor | Max | Notes |
|---|--:|---|
| Hotspot (churn × cognitive_max) | 40 | Strongest signal; normalized to package 90th-pct |
| Complexity peak (worst function) | 20 | Comprehension cliff |
| High fan-out (cross-package imports) | 15 | Blast radius when changing |
| High fan-in (this file is depended on) | 15 | Blast radius when broken |
| Cohesion (LCOM4 > 3) | 10 | Internal structure problem |
| Recency | tiebreaker | Top quartile of recent churn |

**Bus-factor explicitly excluded from risk.** Rationale: agentic coding makes knowledge-concentration a lower-priority risk than comprehension difficulty + blast radius. Ownership data stays in `FileProfile.ownership` and on the page (for downstream team-shaped reports), just doesn't drive the score.

Score sum clamped at 100. Band by quartile: healthy <25, watch 25-49, elevated 50-74, urgent ≥75.

## L2 File Page (PR #2 — the artifact)

Sections, in order:
1. Identity header (role · package link)
2. Risk callout blockquote (score + band + 1-line rationale)
3. "What it does" (deterministic 1-line summary v1; LLM overlay later)
4. At-a-glance metric grid (size · complexity · linkage · ownership · activity)
5. "Why risk N" — hierarchical, evidence-cited
6. Functions and classes table (per-function metrics + risk colour)
7. Outbound imports (with cross-package flag)
8. Inbound files (or note about entrypoint registration)
9. Co-edited files (last 30d, ≥2)
10. Suggested next moves (evidence-linked)

Same data renders as JSON for agents. Each section is a structured field; the markdown is just a ribbon.

## PR overlay (PR #3)

Per-file delta artifact rendered when `--vs <ref>` is set:
- Risk before → after with delta and band change
- LOC / cognitive / classes deltas
- Function-level table: which symbols changed and by how much
- "What changed" bullets (synthesized: new outbound imports, complexity grew, etc.)
- "Reviewer prompts": natural-language questions worth asking in review

## Build sequence

| # | PR | Ships | LoC |
|--:|---|---|--:|
| 1 | Profile + RiskScore shared service | `assembleFileProfile`, `computeRiskScore`, `graph profile <id>` debug command + JSON. Existing report/wiki retrofitted to read score (no behavior change). | ~400 |
| 2 | L2 File Page artifact | `graph file <id>` command (text + JSON). `graph wiki --include-files` writes `docs/wiki/files/<slug>.md` linked from L1. | ~500 |
| 3 | PR overlay for file pages | `graph file <id> --vs <ref>`, `graph wiki --include-files --vs <ref>`. Delta synthesizer. | ~300 |
| 4 | Recommendations engine v1 | Static rule pack (~6 patterns) emitting `Suggestion[]` from profile, with cited evidence. | ~250 |
| 5 | Deterministic 1-line summaries | Filename + role + imports → summary string. Content-hash cached. | ~150 |

After PR 5: full per-file vertical slice. Then L0 system map, L1 enrichment, then substrate work (symbol nodes, call edges).

## Decisions baked in

- **Risk score: opinionated v1.** Hard-coded recipe with exposed rationale. Config override added only if 2+ users disagree with weights.
- **Summaries: deterministic v1.** LLM overlay deferred (CW-11.01 in backlog), keyed by content_hash when it ships.
- **Recommendations: opinionated with evidence.** Each suggestion cites the metric or pattern that drove it; never bare "you should refactor."

## Out of scope (intentionally)

- Domain detection beyond packages — defer until packages-as-domains breaks down
- Symbol-level nodes (class, function) — defer; LCOM4 already gives per-class signal at file granularity
- Call edges (function → function) — defer; imports + churn cover most of what risk recipe needs
- LLM enrichment of any kind
- L0 system map and rollups — deferred until file-level is proven

## Reference
- Brainstorming session 2026-05-12 evening (after M42 — PRs #16/#17/#18).
- Related backlog: CW-09.04 side panel reads from this same Profile; CW-11.01 summary overlay extends `FileProfile.summary`.


---

### File: packages/graph/src/source-metrics.ts

```
import type { ParsedFile } from "@code-style/core";
import type { Node } from "web-tree-sitter";
import { cognitiveComplexityOf } from "./cognitive-complexity.js";
import { computeLcomMetrics } from "./lcom.js";
import type { GraphMetric } from "./types.js";

const TS_FUNCTION_TYPES = new Set([
  "function_declaration",
  "method_definition",
]);

const PY_FUNCTION_TYPES = new Set(["function_definition"]);

const TS_NESTING_TYPES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "try_statement",
]);

const PY_NESTING_TYPES = new Set([
  "if_statement",
  "for_statement",
  "while_statement",
  "try_statement",
]);

const TS_BRANCH_TYPES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "catch_clause",
  "ternary_expression",
]);

const PY_BRANCH_TYPES = new Set([
  "if_statement",
  "elif_clause",
  "for_statement",
  "while_statement",
  "except_clause",
  "conditional_expression",
]);

interface FunctionStats {
  cyclomatic: number;
  cognitive: number;
  nestingDepth: number;
}

export function computeSourceMetrics(
  files: readonly ParsedFile[],
  fileIdOf: (filePath: string) => string,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  for (const file of files) {
    const id = fileIdOf(file.filePath);
    out.push(...metricsForFile(id, file));
  }
  return out;
}

function metricsForFile(nodeId: string, file: ParsedFile): GraphMetric[] {
  const out: GraphMetric[] = [];
  const loc = countLoc(file.content);
  out.push({ nodeId, name: "loc", value: loc, unit: "lines" });

  const stats = analyzeFunctions(file);
  out.push({
    nodeId,
    name: "function_count",
    value: stats.length,
    unit: "count",
  });

  if (stats.length > 0) {
    out.push({
      nodeId,
      name: "cyclomatic_max",
      value: Math.max(...stats.map((s) => s.cyclomatic)),
      unit: "count",
    });
    out.push({
      nodeId,
      name: "cyclomatic_sum",
      value: stats.reduce((acc, s) => acc + s.cyclomatic, 0),
      unit: "count",
    });
    out.push({
      nodeId,
      name: "cognitive_max",
      value: Math.max(...stats.map((s) => s.cognitive)),
      unit: "count",
    });
    out.push({
      nodeId,
      name: "cognitive_sum",
      value: stats.reduce((acc, s) => acc + s.cognitive, 0),
      unit: "count",
    });
    out.push({
      nodeId,
      name: "max_nesting_depth",
      value: Math.max(...stats.map((s) => s.nestingDepth)),
      unit: "count",
    });
  }
  out.push(...computeLcomMetrics(file, nodeId));
  return out;
}

function countLoc(content: string): number {
  return content.split("\n").filter((l) => l.trim() !== "").length;
}

function analyzeFunctions(file: ParsedFile): FunctionStats[] {
  const stats: FunctionStats[] = [];
  const fnTypes =
    file.language === "python" ? PY_FUNCTION_TYPES : TS_FUNCTION_TYPES;
  const visit = (node: Node): void => {
    if (fnTypes.has(node.type)) {
      const body = node.childForFieldName("body");
      if (body) {
        stats.push({
          cyclomatic: cyclomaticOf(body, file.language),
          cognitive: cognitiveComplexityOf(body, file.language),
          nestingDepth: nestingDepthOf(body, file.language, 0),
        });
      }
    }
    for (const child of node.children) {
      if (child) visit(child);
    }
  };
  visit(file.tree.rootNode);
  return stats;
}

function nestingDepthOf(node: Node, language: string, depth: number): number {
  const nestingTypes =
    language === "python" ? PY_NESTING_TYPES : TS_NESTING_TYPES;
  let maxDepth = depth;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const next = nestingTypes.has(child.type) ? depth + 1 : depth;
    const childMax = nestingDepthOf(child, language, next);
    if (childMax > maxDepth) maxDepth = childMax;
  }
  return maxDepth;
}

function cyclomaticOf(body: Node, language: string): number {
  const branchTypes =
    language === "python" ? PY_BRANCH_TYPES : TS_BRANCH_TYPES;
  let complexity = 1;
  const visit = (node: Node): void => {
    if (branchTypes.has(node.type)) complexity++;
    if (node.type === "binary_expression") {
      const op = node.childForFieldName("operator");
      if (op && (op.text === "&&" || op.text === "||")) complexity++;
    }
    if (language === "python" && node.type === "boolean_operator") {
      complexity++;
    }
    for (const child of node.namedChildren) {
      if (child) visit(child);
    }
  };
  visit(body);
  return complexity;
}

```

---

### File: packages/graph/src/ownership.ts

```
import type { ChurnEntry } from "./churn.js";
import type { GraphMetric } from "./types.js";

export interface OwnershipForFile {
  /** Distinct contributing authors. */
  authors: number;
  /** Fraction of churn (lines) from the single largest contributor (0..1). */
  topAuthorShare: number;
  /** Min number of authors whose combined contribution covers >= 50% of churn. */
  busFactor: number;
}

export interface ComputeOwnershipOptions {
  windowDays?: number;
  knownFileIds?: ReadonlySet<string>;
  /** Coverage threshold for bus_factor (default 0.5 = 50% of churn). */
  busFactorThreshold?: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_BUS_FACTOR_THRESHOLD = 0.5;

export function computeOwnershipMetrics(
  entries: readonly ChurnEntry[],
  options: ComputeOwnershipOptions = {},
): GraphMetric[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const threshold =
    options.busFactorThreshold ?? DEFAULT_BUS_FACTOR_THRESHOLD;
  const linesByAuthor = groupByFileAndAuthor(entries, options.knownFileIds);
  const suffix = `${windowDays}d`;
  const out: GraphMetric[] = [];
  for (const [filePath, byAuthor] of linesByAuthor) {
    const summary = summarizeFile(byAuthor, threshold);
    if (summary === null) continue;
    out.push(
      {
        nodeId: filePath,
        name: `bus_factor_${suffix}`,
        value: summary.busFactor,
        unit: "count",
      },
      {
        nodeId: filePath,
        name: `top_author_share_${suffix}`,
        value: round3(summary.topAuthorShare),
        unit: "ratio",
      },
    );
  }
  return out;
}

function groupByFileAndAuthor(
  entries: readonly ChurnEntry[],
  known: ReadonlySet<string> | undefined,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (known && !known.has(e.filePath)) continue;
    const lines = e.added + e.deleted;
    if (lines === 0) continue;
    let byAuthor = out.get(e.filePath);
    if (!byAuthor) {
      byAuthor = new Map();
      out.set(e.filePath, byAuthor);
    }
    byAuthor.set(e.author, (byAuthor.get(e.author) ?? 0) + lines);
  }
  return out;
}

function summarizeFile(
  byAuthor: ReadonlyMap<string, number>,
  threshold: number,
): OwnershipForFile | null {
  let total = 0;
  for (const v of byAuthor.values()) total += v;
  if (total === 0) return null;
  const sorted = [...byAuthor.values()].sort((a, b) => b - a);
  const topAuthorShare = sorted[0]! / total;
  const busFactor = minAuthorsToReach(sorted, total, threshold);
  return { authors: sorted.length, topAuthorShare, busFactor };
}

function minAuthorsToReach(
  sortedDesc: readonly number[],
  total: number,
  threshold: number,
): number {
  let acc = 0;
  for (let i = 0; i < sortedDesc.length; i++) {
    acc += sortedDesc[i]!;
    if (acc / total >= threshold) return i + 1;
  }
  return sortedDesc.length;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

```

---

### File: packages/graph/src/churn.ts

```
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { detectGitToplevel, discoveryEnv } from "./git-renames.js";
import type { GraphMetric } from "./types.js";

export interface ChurnEntry {
  commit: string;
  /** Author identity — git author email (%ae); stable across name spelling drift. */
  author: string;
  filePath: string;
  added: number;
  deleted: number;
}

export interface ComputeChurnOptions {
  repoRoot: string;
  windowDays?: number;
  knownFileIds?: ReadonlySet<string>;
}

const DEFAULT_WINDOW_DAYS = 30;
const COMMIT_HASH_RE = /^[0-9a-f]{7,40}$/;
const NUMSTAT_FIRST_RE = /^(\d+|-)$/;

export function computeChurnMetrics(options: ComputeChurnOptions): GraphMetric[] {
  const entries = loadChurnEntries(options) ?? [];
  return aggregateChurn(
    entries,
    options.windowDays ?? DEFAULT_WINDOW_DAYS,
    options.knownFileIds,
  );
}

/**
 * Parse the last `windowDays` of git history into ChurnEntry[] rebased onto
 * `repoRoot`. Returns null if git isn't available; [] if no commits matched.
 * Used both for churn metrics and for change-coupling.
 */
export function loadChurnEntries(
  options: ComputeChurnOptions,
): ChurnEntry[] | null {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const gitRoot = detectGitToplevel(options.repoRoot);
  if (gitRoot === null) return null;
  const log = runGitLog(options.repoRoot, windowDays);
  if (log === null) return null;
  const canonicalRoot = canonicalize(options.repoRoot);
  return parseChurnLog(log).flatMap((entry) =>
    rebaseEntry(entry, gitRoot, canonicalRoot),
  );
}

function rebaseEntry(
  entry: ChurnEntry,
  gitRoot: string,
  rootDir: string,
): ChurnEntry[] {
  const abs = path.resolve(gitRoot, entry.filePath);
  const rel = path.relative(rootDir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return [];
  return [{ ...entry, filePath: toPosix(rel) }];
}

function canonicalize(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function parseChurnLog(text: string): ChurnEntry[] {
  const out: ChurnEntry[] = [];
  let commit = "";
  let author = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length === 2 && COMMIT_HASH_RE.test(parts[0]!)) {
      commit = parts[0]!;
      author = parts[1]!;
      continue;
    }
    if (parts.length === 3 && commit && NUMSTAT_FIRST_RE.test(parts[0]!)) {
      const added = parts[0] === "-" ? 0 : Number(parts[0]);
      const deleted = parts[1] === "-" ? 0 : Number(parts[1]);
      const filePath = resolveRenamedPath(parts[2]!);
      out.push({ commit, author, filePath, added, deleted });
    }
  }
  return out;
}

export function resolveRenamedPath(rawPath: string): string {
  const braceMatch = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rawPath);
  if (braceMatch) {
    const [, prefix, , newSeg, suffix] = braceMatch;
    return collapseSlashes(`${prefix}${newSeg}${suffix}`);
  }
  const arrow = rawPath.indexOf(" => ");
  if (arrow >= 0) return rawPath.slice(arrow + 4);
  return rawPath;
}

export function aggregateChurn(
  entries: readonly ChurnEntry[],
  windowDays: number,
  knownFileIds?: ReadonlySet<string>,
): GraphMetric[] {
  const lines = new Map<string, number>();
  const commits = new Map<string, Set<string>>();
  const authors = new Map<string, Set<string>>();
  for (const e of entries) {
    if (knownFileIds && !knownFileIds.has(e.filePath)) continue;
    lines.set(e.filePath, (lines.get(e.filePath) ?? 0) + e.added + e.deleted);
    setAdd(commits, e.filePath, e.commit);
    setAdd(authors, e.filePath, e.author);
  }
  const suffix = `${windowDays}d`;
  const out: GraphMetric[] = [];
  for (const [filePath, total] of lines) {
    out.push({ nodeId: filePath, name: `churn_${suffix}`, value: total, unit: "lines" });
    out.push({
      nodeId: filePath,
      name: `churn_${suffix}_commits`,
      value: commits.get(filePath)!.size,
      unit: "count",
    });
    out.push({
      nodeId: filePath,
      name: `churn_${suffix}_authors`,
      value: authors.get(filePath)!.size,
      unit: "count",
    });
  }
  return out;
}

function setAdd(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function collapseSlashes(s: string): string {
  return s.replace(/\/+/g, "/");
}

function runGitLog(repoRoot: string, windowDays: number): string | null {
  try {
    return execFileSync(
      "git",
      [
        "log",
        `--since=${windowDays}.days.ago`,
        "--no-merges",
        "--numstat",
        "-M",
        // %ae (author email) is a more stable identity than %an (display name):
        // names drift across spelling variants ("Henry Jewkes" / "hjewkes" /
        // bot or squash-merge display names) and inflate distinct-author counts.
        "--pretty=format:%H%x09%ae",
      ],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        env: discoveryEnv(),
      },
    );
  } catch {
    return null;
  }
}

```

---

### File: packages/graph/src/pagerank.ts

```
import type { EdgeKind, GraphEdge, GraphNode } from "./types.js";

export interface PageRankOptions {
  /** Per-node teleport weight. Unset or empty → uniform teleport across all nodes. */
  personalization?: ReadonlyMap<string, number>;
  /** Probability of following an edge vs teleporting (default 0.85). */
  damping?: number;
  /** L1 convergence threshold (default 1e-6). */
  tolerance?: number;
  /** Cap on power-iteration steps (default 100). */
  maxIterations?: number;
  /** Per-kind edge weight; missing kinds default to 1.0. */
  edgeWeights?: Partial<Record<EdgeKind, number>>;
}

export interface PageRankRow {
  nodeId: string;
  score: number;
}

export interface PageRankResult {
  /** Sorted descending by score; ties broken by node id ascending. */
  rows: PageRankRow[];
  iterations: number;
  converged: boolean;
}

const DEFAULT_DAMPING = 0.85;
const DEFAULT_TOLERANCE = 1e-6;
const DEFAULT_MAX_ITERS = 100;

const DEFAULT_EDGE_WEIGHTS: Record<EdgeKind, number> = {
  imports: 1.0,
  "re-exports": 0.5,
  calls: 1.5,
  extends: 1.0,
  implements: 1.0,
  references: 1.0,
  "depends-on": 1.0,
};

interface Adjacency {
  outNeighbors: Array<Array<{ to: number; w: number }>>;
  outWeightSum: number[];
}

export function computePageRank(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: PageRankOptions = {},
): PageRankResult {
  const n = nodes.length;
  if (n === 0) return { rows: [], iterations: 0, converged: true };

  const damping = options.damping ?? DEFAULT_DAMPING;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIters = options.maxIterations ?? DEFAULT_MAX_ITERS;
  const weights = { ...DEFAULT_EDGE_WEIGHTS, ...(options.edgeWeights ?? {}) };

  const idx = buildIdIndex(nodes);
  const adj = buildAdjacency(idx, edges, weights, n);
  const pers = buildPersonalization(idx, n, options.personalization);

  const { rank, iterations, converged } = powerIterate(
    pers,
    adj,
    damping,
    tolerance,
    maxIters,
  );

  return { rows: rankToRows(nodes, rank), iterations, converged };
}

function buildIdIndex(nodes: readonly GraphNode[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) idx.set(nodes[i]!.id, i);
  return idx;
}

function buildAdjacency(
  idx: ReadonlyMap<string, number>,
  edges: readonly GraphEdge[],
  weights: Record<EdgeKind, number>,
  n: number,
): Adjacency {
  const outNeighbors: Array<Array<{ to: number; w: number }>> = Array.from(
    { length: n },
    () => [],
  );
  const outWeightSum = new Array<number>(n).fill(0);
  for (const e of edges) {
    const si = idx.get(e.srcId);
    const di = idx.get(e.dstId);
    if (si === undefined || di === undefined) continue;
    const w = weights[e.kind] ?? 1.0;
    if (w <= 0) continue;
    outNeighbors[si]!.push({ to: di, w });
    outWeightSum[si]! += w;
  }
  return { outNeighbors, outWeightSum };
}

function powerIterate(
  pers: readonly number[],
  adj: Adjacency,
  damping: number,
  tolerance: number,
  maxIters: number,
): { rank: number[]; iterations: number; converged: boolean } {
  const n = pers.length;
  let rank = pers.slice();
  let next = new Array<number>(n).fill(0);
  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < maxIters; iter++) {
    iterations = iter + 1;
    const dangling = sumDangling(rank, adj.outWeightSum);
    const teleport = 1 - damping + damping * dangling;
    seedTeleport(next, pers, teleport);
    distributeRank(next, rank, adj, damping);
    const diff = l1Diff(rank, next);
    [rank, next] = [next, rank];
    next.fill(0);
    if (diff < tolerance) {
      converged = true;
      break;
    }
  }
  return { rank, iterations, converged };
}

function sumDangling(
  rank: readonly number[],
  outWeightSum: readonly number[],
): number {
  let total = 0;
  for (let i = 0; i < rank.length; i++) {
    if (outWeightSum[i] === 0) total += rank[i]!;
  }
  return total;
}

function seedTeleport(
  next: number[],
  pers: readonly number[],
  teleport: number,
): void {
  for (let i = 0; i < next.length; i++) next[i] = teleport * pers[i]!;
}

function distributeRank(
  next: number[],
  rank: readonly number[],
  adj: Adjacency,
  damping: number,
): void {
  for (let i = 0; i < rank.length; i++) {
    const s = adj.outWeightSum[i]!;
    if (s === 0 || rank[i]! === 0) continue;
    const factor = (damping * rank[i]!) / s;
    const list = adj.outNeighbors[i]!;
    for (let k = 0; k < list.length; k++) {
      next[list[k]!.to]! += factor * list[k]!.w;
    }
  }
}

function l1Diff(a: readonly number[], b: readonly number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(b[i]! - a[i]!);
  return diff;
}

function rankToRows(
  nodes: readonly GraphNode[],
  rank: readonly number[],
): PageRankRow[] {
  return nodes
    .map((node, i) => ({ nodeId: node.id, score: rank[i]! }))
    .sort(compareRows);
}

function compareRows(a: PageRankRow, b: PageRankRow): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
}

function buildPersonalization(
  idx: ReadonlyMap<string, number>,
  n: number,
  pers: PageRankOptions["personalization"],
): number[] {
  if (!pers || pers.size === 0) return uniformVector(n);
  const out = new Array<number>(n).fill(0);
  const total = applySeedWeights(out, idx, pers);
  if (total === 0) return uniformVector(n);
  for (let i = 0; i < n; i++) out[i]! /= total;
  return out;
}

function uniformVector(n: number): number[] {
  return new Array<number>(n).fill(1 / n);
}

function applySeedWeights(
  out: number[],
  idx: ReadonlyMap<string, number>,
  pers: NonNullable<PageRankOptions["personalization"]>,
): number {
  let total = 0;
  for (const [id, w] of pers) {
    if (!isValidWeight(w)) continue;
    const i = idx.get(id);
    if (i === undefined) continue;
    out[i] = w;
    total += w;
  }
  return total;
}

function isValidWeight(w: number): boolean {
  return Number.isFinite(w) && w > 0;
}

```

---

### File: packages/cli/src/commands/graph-report-sections.ts

```
import {
  computeChangeCoupling,
  computePageRank,
  loadChurnEntries,
  matchesAny,
  type CoEditPair,
  type GraphEdge,
  type GraphMetric,
  type GraphNode,
} from "@code-style/graph";
import type {
  BusFactorRow,
  CentralRow,
  CouplingRow,
  HotspotRow,
} from "./graph-report-types.js";

const COMPLEXITY_METRICS = ["cognitive_max", "cyclomatic_max"] as const;

export interface ReportContext {
  nodes: readonly GraphNode[];
  nodeById: Map<string, GraphNode>;
  metricsByName: Map<string, Map<string, number>>;
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

export interface ReportContextInput {
  nodes: readonly GraphNode[];
  metrics: readonly GraphMetric[];
  excluders: readonly RegExp[];
  excludedRoles: ReadonlySet<string>;
  windowDays: number;
}

export function buildReportContext(input: ReportContextInput): ReportContext {
  const metricsByName = new Map<string, Map<string, number>>();
  for (const m of input.metrics) {
    if (m.value === null) continue;
    let bucket = metricsByName.get(m.name);
    if (!bucket) {
      bucket = new Map();
      metricsByName.set(m.name, bucket);
    }
    bucket.set(m.nodeId, m.value);
  }
  return {
    nodes: input.nodes,
    nodeById: new Map(input.nodes.map((n) => [n.id, n])),
    metricsByName,
    excluders: input.excluders,
    excludedRoles: input.excludedRoles,
    windowDays: input.windowDays,
  };
}

export function keepNode(ctx: ReportContext, nodeId: string): boolean {
  if (matchesAny(nodeId, ctx.excluders)) return false;
  const node = ctx.nodeById.get(nodeId);
  if (!node || node.kind !== "file") return false;
  if (node.role && ctx.excludedRoles.has(node.role)) return false;
  return true;
}

function lookupMetric(
  ctx: ReportContext,
  name: string,
  nodeId: string,
): number | undefined {
  return ctx.metricsByName.get(name)?.get(nodeId);
}

function pickComplexityMetric(ctx: ReportContext): string {
  for (const m of COMPLEXITY_METRICS) {
    if (ctx.metricsByName.has(m)) return m;
  }
  return "cyclomatic_max";
}

export function topHotspots(
  ctx: ReportContext,
  limit: number,
): HotspotRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const complexityName = pickComplexityMetric(ctx);
  const rows: HotspotRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const churn = lookupMetric(ctx, churnName, node.id) ?? 0;
    const complexity = lookupMetric(ctx, complexityName, node.id) ?? 0;
    if (churn === 0 || complexity === 0) continue;
    rows.push({ nodeId: node.id, churn, complexity, score: churn * complexity });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

export function hotspotScoreOf(ctx: ReportContext, nodeId: string): number {
  if (!keepNode(ctx, nodeId)) return 0;
  const churn = lookupMetric(ctx, `churn_${ctx.windowDays}d`, nodeId) ?? 0;
  const complexity = lookupMetric(ctx, pickComplexityMetric(ctx), nodeId) ?? 0;
  if (churn === 0 || complexity === 0) return 0;
  return churn * complexity;
}

export function busFactorOf(
  ctx: ReportContext,
  nodeId: string,
): number | undefined {
  return lookupMetric(ctx, `bus_factor_${ctx.windowDays}d`, nodeId);
}

export function topBusFactorRisks(
  ctx: ReportContext,
  limit: number,
): BusFactorRow[] {
  const churnName = `churn_${ctx.windowDays}d`;
  const bfName = `bus_factor_${ctx.windowDays}d`;
  const shareName = `top_author_share_${ctx.windowDays}d`;
  const rows: BusFactorRow[] = [];
  for (const node of ctx.nodes) {
    if (!keepNode(ctx, node.id)) continue;
    const bf = lookupMetric(ctx, bfName, node.id);
    if (bf === undefined || bf > 1) continue;
    rows.push({
      nodeId: node.id,
      busFactor: bf,
      topAuthorShare: lookupMetric(ctx, shareName, node.id) ?? 1,
      churn: lookupMetric(ctx, churnName, node.id) ?? 0,
    });
  }
  rows.sort((a, b) => b.churn - a.churn);
  return rows.slice(0, limit);
}

export function topCouplingClusters(
  ctx: ReportContext,
  repoRoot: string,
  windowDays: number,
  limit: number,
): CouplingRow[] {
  const entries = loadChurnEntries({
    repoRoot,
    windowDays,
    knownFileIds: collectKeptFileIds(ctx),
  });
  if (entries === null) return [];
  const { pairs } = computeChangeCoupling(entries, { minCount: 2 });
  const filtered = pairs.filter(
    (p) => keepNode(ctx, p.fileA) && keepNode(ctx, p.fileB),
  );
  return filtered.slice(0, limit).map(toCouplingRow);
}

function toCouplingRow(p: CoEditPair): CouplingRow {
  return { fileA: p.fileA, fileB: p.fileB, count: p.count };
}

export function topCentralFiles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ctx: ReportContext,
  limit: number,
): CentralRow[] {
  const pageRank = computePageRank(nodes, edges, {});
  const rows: CentralRow[] = [];
  for (const r of pageRank.rows) {
    if (!keepNode(ctx, r.nodeId)) continue;
    rows.push({ nodeId: r.nodeId, score: r.score });
    if (rows.length >= limit) break;
  }
  return rows;
}

function collectKeptFileIds(ctx: ReportContext): Set<string> {
  const out = new Set<string>();
  for (const node of ctx.nodes) if (keepNode(ctx, node.id)) out.add(node.id);
  return out;
}

```

---

### File: packages/cli/src/commands/graph-wiki-sections.ts

*(not found)*

---

### File: packages/graph/src/types.ts

```
export type NodeKind =
  | "package"
  | "module"
  | "file"
  | "symbol"
  | "external";

export type EdgeKind =
  | "imports"
  | "re-exports"
  | "calls"
  | "extends"
  | "implements"
  | "references"
  | "depends-on";

export type IdAliasReason = "rename" | "move" | "merge";

export type NodeRole =
  | "test"
  | "fixture"
  | "barrel"
  | "types"
  | "config"
  | "source";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId?: string;
  language?: string;
  role?: NodeRole;
  attrs?: Record<string, unknown>;
}

export interface GraphEdge {
  srcId: string;
  dstId: string;
  kind: EdgeKind;
  attrs?: Record<string, unknown>;
}

export interface GraphMetric {
  nodeId: string;
  name: string;
  value: number | null;
  unit?: string;
}

export interface GraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SnapshotRow {
  id: number;
  ref: string;
  commitHash: string | null;
  takenAt: string;
  indexVersion: string;
  attrs: Record<string, unknown>;
}

export interface EntryPoint {
  nodeId: string;
  kind: string;
  attrs?: Record<string, unknown>;
}

export interface IdAlias {
  oldId: string;
  newId: string;
  reason: IdAliasReason;
}

export interface MetricDelta {
  nodeId: string;
  name: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface NodeRename {
  oldId: string;
  newId: string;
  reason: IdAliasReason;
  node: GraphNode;
}

export interface GraphDiffSummary {
  fromSnapshotId: number;
  toSnapshotId: number;
  addedNodes: number;
  removedNodes: number;
  renamedNodes: number;
  unchangedNodes: number;
  addedEdges: number;
  removedEdges: number;
  metricChanges: number;
}

export interface GraphDiff {
  summary: GraphDiffSummary;
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  renamedNodes: NodeRename[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
  metricDeltas: MetricDelta[];
}

export type Severity = "error" | "warning";

export interface MetricMaxRule {
  type: "metric-max";
  id: string;
  metric: string;
  max: number;
  kind?: NodeKind;
  severity?: Severity;
  exclude?: string[];
  excludeRoles?: NodeRole[];
}

export interface MetricMinRule {
  type: "metric-min";
  id: string;
  metric: string;
  min: number;
  kind?: NodeKind;
  severity?: Severity;
  exclude?: string[];
  excludeRoles?: NodeRole[];
}

export interface MetricProductMaxRule {
  type: "metric-product-max";
  id: string;
  metrics: string[];
  max: number;
  kind?: NodeKind;
  severity?: Severity;
  exclude?: string[];
  excludeRoles?: NodeRole[];
}

export interface ForbidImportRule {
  type: "forbid-import";
  id: string;
  from: string;
  to: string;
  severity?: Severity;
}

export interface LayeredDepsRule {
  type: "layered-deps";
  id: string;
  layers: string[][];
  severity?: Severity;
}

export type CheckRule =
  | MetricMaxRule
  | MetricMinRule
  | MetricProductMaxRule
  | ForbidImportRule
  | LayeredDepsRule;

export interface CheckRulesFile {
  rules: CheckRule[];
}

export interface CheckViolation {
  ruleId: string;
  severity: Severity;
  nodeId: string;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
  destinationId?: string;
  isCarryover?: boolean;
}

export interface CheckResult {
  snapshotId: number;
  baselineSnapshotId?: number;
  rulesEvaluated: number;
  nodesEvaluated: number;
  violations: CheckViolation[];
  newErrors: number;
  newWarnings: number;
  carryoverErrors: number;
  carryoverWarnings: number;
  passed: boolean;
}

```

---

### File: packages/graph/src/index.ts

```
export type {
  NodeKind,
  NodeRole,
  EdgeKind,
  IdAliasReason,
  GraphNode,
  GraphEdge,
  GraphMetric,
  GraphFragment,
  SnapshotRow,
  EntryPoint,
  IdAlias,
  MetricDelta,
  NodeRename,
  GraphDiff,
  GraphDiffSummary,
  Severity,
  CheckRule,
  MetricMaxRule,
  MetricMinRule,
  MetricProductMaxRule,
  ForbidImportRule,
  LayeredDepsRule,
  CheckRulesFile,
  CheckViolation,
  CheckResult,
} from "./types.js";

export { runMigrations } from "./migrations.js";
export { openDatabase, GraphDatabase } from "./database.js";

export {
  TsMorphGraphExtractor,
  type TsMorphGraphExtractorOptions,
} from "./extractors/ts-morph-extractor.js";
export {
  fileId,
  moduleId,
  parentModuleId,
  packageId,
  externalId,
} from "./extractors/ids.js";

export {
  runGraphIndex,
  type GraphIndexOptions,
  type GraphIndexResult,
  type GraphIndexDurations,
} from "./indexer.js";

export { diffSnapshots, type DiffSnapshotsOptions } from "./diff.js";
export { computeMetrics } from "./metrics.js";
export { computeSourceMetrics } from "./source-metrics.js";
export { computeLcomMetrics } from "./lcom.js";
export {
  computeChurnMetrics,
  loadChurnEntries,
  parseChurnLog,
  aggregateChurn,
  resolveRenamedPath,
  type ChurnEntry,
  type ComputeChurnOptions,
} from "./churn.js";
export {
  computeChangeCoupling,
  couplingFor,
  type CoEditPair,
  type ChangeCouplingResult,
  type ComputeChangeCouplingOptions,
} from "./change-coupling.js";
export {
  computeOwnershipMetrics,
  type ComputeOwnershipOptions,
  type OwnershipForFile,
} from "./ownership.js";
export { patternToRegex, compilePatterns, matchesAny } from "./patterns.js";
export {
  computePageRank,
  type PageRankOptions,
  type PageRankResult,
  type PageRankRow,
} from "./pagerank.js";
export { runChecks, validateRules, type RunChecksOptions } from "./check.js";
export {
  diffCheckResults,
  type CheckDiff,
  type DiffCheckResultsOptions,
  type UnchangedViolation,
} from "./check-diff.js";
export { classifyRole, annotateRoles, ALL_ROLES } from "./roles.js";
export {
  planPrune,
  runPrune,
  type PrunePlan,
  type PruneOptions,
  type PruneResult,
} from "./prune.js";

```

---

### Prior Context

Brainstorming session 2026-05-12 evening landed on 3-layer structure (substrate -> insight -> artifact) with file-first build. M42 just shipped: PR #16 graph relevant --explain, PR #17 graph wiki, PR #18 LCOM4 metric. This PR is the foundation that PRs 2-5 build on. User explicitly removed bus_factor from risk recipe citing agentic-coding context (knowledge concentration matters less when LLMs read code on demand; comprehension + blast radius matter more); the 25 points that bus_factor had were redistributed to complexity_peak (+5), high_fanout (+5), and a NEW high_fanin factor (+15).

---

### Interview Answers

Risk score: opinionated v1 (hard-coded recipe with exposed rationale; config override only if multiple users disagree). Summaries: deterministic v1 (filename + role + imports -> summary string); LLM overlay deferred (CW-11.01). Recommendations: out of scope for this PR. Bus-factor: in data model, not in risk recipe. Symbol nodes / call edges / domain detection: explicitly out of scope, deferred. PRs 2-5 cover L2 file page, PR-overlay, recommendations engine, deterministic summaries.