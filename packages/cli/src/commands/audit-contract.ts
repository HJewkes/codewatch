import { parseSymbolId, type Finding, type GraphEdge, type GraphNode } from "@titan-design/code-graph";
import { getLanguageFromPath, parseFile, type ParsedFile } from "@titan-design/code-parser";
import { touches, type ChangedLines } from "./audit-changed.js";
import type { MetricIndex } from "./audit-collect.js";
import { errorKey, paramsAt, type ErrorSite } from "./audit-contract-facts.js";
import { assertingLines, lostErrors, type OwnerOf } from "./audit-contract-errors.js";
import { paramChanges, type CallSite } from "./audit-contract-params.js";
import { callersByCallee, citation, reachingTests, spanOf } from "./audit-graph-walk.js";

export interface ContractSnapshot {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  metrics: MetricIndex;
}

export interface ContractInput {
  base: ContractSnapshot;
  head: ContractSnapshot;
  changed: ChangedLines;
  /** File text at the base ref and in the working tree; undefined when the file is absent there. */
  readBase: (file: string) => string | undefined;
  readHead: (file: string) => string | undefined;
}

const PYTHON_TEST_PATH = /(?:^|\/)(?:tests?\/|test_[^/]*\.py$|[^/]*_test\.py$|conftest\.py$)/;
const TS_TEST_PATH = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const LISTED = 5;

const fileOf = (id: string): string => parseSymbolId(id)?.fileId ?? id;
const isTestPath = (file: string): boolean => PYTHON_TEST_PATH.test(file) || TS_TEST_PATH.test(file);
const slug = (text: string): string => text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

interface Context {
  input: ContractInput;
  headNodes: ReadonlyMap<string, GraphNode>;
  callers: ReadonlyMap<string, readonly string[]>;
  sitesInto: ReadonlyMap<string, ReadonlyMap<string, readonly CallSite[] | undefined>>;
  isTest: (id: string) => boolean;
}

/** Per callee, each caller's recorded call sites; undefined when the edge carries none. */
function sitesByCallee(edges: readonly GraphEdge[]): Map<string, Map<string, CallSite[] | undefined>> {
  const out = new Map<string, Map<string, CallSite[] | undefined>>();
  for (const e of edges) {
    if (e.kind !== "calls" || e.srcId === e.dstId) continue;
    const sites = e.attrs?.sites;
    const into = out.get(e.dstId) ?? new Map<string, CallSite[] | undefined>();
    into.set(e.srcId, Array.isArray(sites) ? (sites as CallSite[]) : undefined);
    out.set(e.dstId, into);
  }
  return out;
}

function ownerIndex(nodes: readonly GraphNode[]): OwnerOf {
  const byFile = new Map<string, { id: string; start: number; end: number }[]>();
  for (const node of nodes) {
    const span = node.kind === "symbol" ? spanOf(node) : undefined;
    if (!span) continue;
    const list = byFile.get(fileOf(node.id)) ?? [];
    list.push({ id: node.id, ...span });
    byFile.set(fileOf(node.id), list);
  }
  return (file, line) =>
    (byFile.get(file) ?? [])
      .filter((s) => s.start <= line && line <= s.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0]?.id;
}

async function parseSide(files: readonly string[], read: (file: string) => string | undefined): Promise<Map<string, ParsedFile>> {
  const out = new Map<string, ParsedFile>();
  for (const file of files) {
    const language = getLanguageFromPath(file);
    const text = read(file);
    if (text !== undefined && (language === "python" || language === "typescript")) out.set(file, await parseFile(text, file, language));
  }
  return out;
}

function inDiff(id: string, ctx: Context): boolean {
  const node = ctx.headNodes.get(id);
  const span = node && spanOf(node);
  if (!span || node.kind !== "symbol") return (ctx.input.changed.get(fileOf(id))?.length ?? 0) > 0;
  return touches(ctx.input.changed, fileOf(id), span);
}

function cite(ids: readonly string[], ctx: Context, named: boolean): string {
  if (ids.length === 0) return "none";
  const label = (id: string): string => {
    const name = named ? parseSymbolId(id)?.name : undefined;
    return name ? `${citation(id, ctx.headNodes)} ${name}` : citation(id, ctx.headNodes);
  };
  const cited = ids.map(label).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const more = cited.length > LISTED ? ` (+${cited.length - LISTED} more)` : "";
  return `${cited.slice(0, LISTED).join(", ")}${more}`;
}

interface Reach {
  callersOut: string[];
  callersIn: string[];
  testsOut: string[];
}

/** Callers whose sites the change affects, split by the diff, and the tests that reach the subject through them. */
function reach(subjectId: string, affects: (site: CallSite | undefined) => boolean, ctx: Context): Reach {
  const affected = [...(ctx.sitesInto.get(subjectId) ?? new Map())]
    .filter(([, sites]) => sites === undefined || sites.length === 0 || sites.some(affects))
    .map(([caller]) => caller);
  const direct = affected.filter(ctx.isTest);
  const callers = affected.filter((id) => !ctx.isTest(id));
  const tests = new Set([...direct, ...callers.flatMap((id) => reachingTests(id, ctx.callers, ctx.isTest))]);
  return {
    callersOut: callers.filter((id) => !inDiff(id, ctx)),
    callersIn: callers.filter((id) => inDiff(id, ctx)),
    testsOut: [...tests].filter((id) => !inDiff(id, ctx)),
  };
}

function finding(subjectId: string, kind: string, detail: string, evidence: string[], ctx: Context): Finding {
  const node = ctx.headNodes.get(subjectId);
  const span = node && spanOf(node);
  return {
    id: `codewatch:contract-change:${subjectId}:${kind}:${slug(detail)}`,
    path: fileOf(subjectId),
    ...(span ? { lineStart: span.start, lineEnd: span.end } : {}),
    symbol: parseSymbolId(subjectId)?.name,
    signal: "contract-change",
    severity: "warning",
    evidence: evidence.join("\n"),
    tool: "codewatch",
  };
}

function reachLines(r: Reach, ctx: Context): string[] {
  return [`callers not in diff: ${cite(r.callersOut, ctx, true)}`, `callers in diff: ${cite(r.callersIn, ctx, true)}`, `tests not in diff: ${cite(r.testsOut, ctx, false)}`];
}

const describeSite = (site: ErrorSite): string =>
  `${site.exception}(${site.exception === "exit" || site.message === "" ? site.message : JSON.stringify(site.message)})${site.via ? ` via ${site.via}` : ""}`;

/** Files holding a test: by path rule, or by a test function code-graph found in them. */
function testFiles(ctx: Context): string[] {
  return [...new Set([...ctx.headNodes.keys()].filter(ctx.isTest).map(fileOf))];
}

function errorFindings(base: Map<string, ParsedFile>, head: Map<string, ParsedFile>, subjects: ReadonlySet<string>, ctx: Context): Finding[] {
  const tests = testFiles(ctx);
  return lostErrors(base, head, ownerIndex(ctx.input.base.nodes), ownerIndex(ctx.input.head.nodes))
    .filter((lost) => subjects.has(lost.ownerId))
    .flatMap((lost) => {
      const site = lost.sites[0]!;
      const r = reach(lost.ownerId, () => true, ctx);
      const asserting = assertingLines(site, tests, ctx.input.readHead, ctx.input.changed);
      if (r.callersOut.length + r.testsOut.length === 0 && asserting.length > 0) return [];
      const was = lost.sites.map((s) => `${lost.file}:${s.line}`).join(", ");
      const evidence = [`change: removed error site ${describeSite(site)}, was ${was} at base`, ...reachLines(r, ctx), `tests asserting it: ${asserting.length === 0 ? "none" : asserting.slice(0, LISTED).join(", ")}`];
      return [finding(lost.ownerId, "error-removed", errorKey(site), evidence, ctx)];
    });
}

function paramFindings(subjectId: string, base: Map<string, ParsedFile>, head: Map<string, ParsedFile>, ctx: Context): Finding[] {
  const file = fileOf(subjectId);
  const baseNode = ctx.input.base.nodes.find((n) => n.id === subjectId);
  const before = baseNode && base.has(file) ? paramsAt(base.get(file)!, spanOf(baseNode)?.start ?? 0) : undefined;
  const after = head.has(file) ? paramsAt(head.get(file)!, spanOf(ctx.headNodes.get(subjectId)!)?.start ?? 0) : undefined;
  if (!before || !after) return [];
  return paramChanges(before, after).flatMap((change) => {
    const r = reach(subjectId, change.affects, ctx);
    if (r.callersOut.length + r.testsOut.length === 0) return [];
    return [finding(subjectId, change.kind, change.detail, [`change: ${change.change}`, ...reachLines(r, ctx)], ctx)];
  });
}

/** Non-test symbols the diff touches that exist on both sides: the only candidates for a contract change. */
function subjectsOf(ctx: Context): Set<string> {
  const baseIds = new Set(ctx.input.base.nodes.map((n) => n.id));
  return new Set(
    [...ctx.headNodes.values()]
      .filter((n) => n.kind === "symbol" && baseIds.has(n.id) && !ctx.isTest(n.id))
      .filter((n) => {
        const span = spanOf(n);
        return span !== undefined && touches(ctx.input.changed, fileOf(n.id), span);
      })
      .map((n) => n.id),
  );
}

/**
 * `contract-change` findings: an error site the diff removed, or a parameter list or default it
 * changed, on a symbol some affected caller or test outside the diff still depends on.
 */
export async function contractFindings(input: ContractInput): Promise<Finding[]> {
  const testFunctions = input.head.metrics.get("test_kind_snapshot") ?? new Map<string, number>();
  const ctx: Context = {
    input,
    headNodes: new Map(input.head.nodes.map((n) => [n.id, n])),
    callers: callersByCallee(input.head.edges),
    sitesInto: sitesByCallee(input.head.edges),
    isTest: (id) => testFunctions.has(id) || isTestPath(fileOf(id)),
  };
  const files = [...input.changed.keys()].filter((f) => !isTestPath(f));
  const [base, head] = [await parseSide(files, input.readBase), await parseSide(files, input.readHead)];
  const subjects = subjectsOf(ctx);
  return [...errorFindings(base, head, subjects, ctx), ...[...subjects].flatMap((id) => paramFindings(id, base, head, ctx))];
}
