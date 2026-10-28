import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSymbolId, type Finding, type GraphEdge, type GraphNode } from "@titan-design/code-graph";
import { parseFile } from "@titan-design/code-parser";
import type { Node } from "web-tree-sitter";
import { lineAttr } from "./audit-collect.js";
import { findEntryPoints, isSourceFile, readConsoleScripts, testFileIds, type EntryPoint } from "./audit-entries.js";
import { fileFlags, findDefinition, paramFacts, readerFacts } from "./audit-input-facts.js";
import { moduleDicts, testFeeds, type FeedFacts } from "./audit-input-feeds.js";
import { citation } from "./audit-test-kinds.js";
import { classifyGaps, inputClassFindings, type EntryCensus, type EntryFacts, type InputClass, type InputClassCensus } from "./audit-input-gaps.js";

export type { InputClassCensus };

export interface CensusInput {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  entries: ReadonlyMap<string, EntryPoint>;
  trees: ReadonlyMap<string, Node>;
  isTest: (id: string) => boolean;
  root: string;
}

const NOTES = [
  "Static only: inputs built at runtime (loops, fixtures, parametrize ids computed from code) are not seen.",
  "Reader keys held in variables (record.get(field)) are not seen.",
  "Pattern-language input classes inside strings are not dict keys or flags and are not seen.",
];

const SUBPROCESS_CALLS = new Set(["run", "check_output", "check_call", "Popen", "invoke"]);

class Graph {
  readonly byId: Map<string, GraphNode>;
  readonly callees = new Map<string, string[]>();
  readonly testFiles: Set<string>;

  constructor(readonly input: CensusInput) {
    this.byId = new Map(input.nodes.map((n) => [n.id, n]));
    for (const e of input.edges) {
      if (e.kind !== "calls" || e.srcId === e.dstId) continue;
      this.callees.set(e.srcId, [...(this.callees.get(e.srcId) ?? []), e.dstId]);
    }
    this.testFiles = testFileIds(input.nodes, input.isTest);
  }

  definition(id: string): Node | undefined {
    const parsed = parseSymbolId(id);
    const node = this.byId.get(id);
    const tree = parsed && this.input.trees.get(parsed.fileId);
    const start = node && lineAttr(node, "startLine");
    const end = node && lineAttr(node, "endLine");
    return tree && start !== undefined && end !== undefined ? findDefinition(tree, parsed.name, start, end) : undefined;
  }

  isSource(id: string): boolean {
    return isSourceFile(parseSymbolId(id)?.fileId, this.testFiles) && this.byId.get(id)?.kind === "symbol";
  }

  closure(id: string): string[] {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      for (const callee of this.callees.get(queue.pop()!) ?? []) {
        if (seen.has(callee) || !this.isSource(callee)) continue;
        seen.add(callee);
        queue.push(callee);
      }
    }
    return [...seen].sort();
  }

  /** Same-file functions a test calls that are not tests themselves. */
  helpers(testId: string): string[] {
    const file = parseSymbolId(testId)?.fileId;
    return (this.callees.get(testId) ?? []).filter((c) => parseSymbolId(c)?.fileId === file && !this.input.isTest(c));
  }
}

const fileOf = (id: string): string => parseSymbolId(id)?.fileId ?? id;
const nameOf = (id: string): string => parseSymbolId(id)?.name ?? id;
const ownName = (id: string): string => nameOf(id).split(".").at(-1)!;

function argvNames(entryId: string, root: string): string[] {
  const file = fileOf(entryId);
  const module = file.replace(/\.py$/, "").replace(/\/__init__$/, "").replaceAll("/", ".");
  const scripts = readConsoleScripts(root).filter((s) => s.target.endsWith(`:${nameOf(entryId)}`)).map((s) => s.name);
  return [module, file.split("/").at(-1)!, ...scripts];
}

const DEFINITIONS = new Set(["function_definition", "class_definition", "decorated_definition"]);

/** A test that spawns a process whose argv, in its bodies or its file's module-level constants, names the entry. */
function runsEntry(graph: Graph, testId: string, names: readonly string[]): boolean {
  const bodies = [testId, ...graph.helpers(testId)].map((id) => graph.definition(id)).filter((n): n is Node => n !== undefined);
  const spawns = bodies.some((b) => b.descendantsOfType("call").some((c) => SUBPROCESS_CALLS.has(c.childForFieldName("function")?.text.split(".").at(-1) ?? "")));
  const constants = (graph.input.trees.get(fileOf(testId))?.namedChildren ?? []).filter((n) => !DEFINITIONS.has(n.type));
  const text = [...bodies, ...constants].map((b) => b.text).join("\n");
  return spawns && names.some((n) => text.includes(`"${n}"`) || text.includes(`'${n}'`) || text.includes(`/${n}"`));
}

function feedingTests(graph: Graph, entryId: string, entry: EntryPoint): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const names = entry.kind === "cli" ? argvNames(entryId, graph.input.root) : [];
  for (const node of graph.input.nodes) {
    if (!graph.input.isTest(node.id)) continue;
    const helpers = graph.helpers(node.id);
    const direct = (graph.callees.get(node.id) ?? []).includes(entryId);
    const viaHelper = helpers.some((h) => (graph.callees.get(h) ?? []).includes(entryId));
    if (direct || viaHelper || (names.length > 0 && runsEntry(graph, node.id, names))) out.set(node.id, helpers);
  }
  return out;
}

function feedFacts(graph: Graph, testId: string, helpers: readonly string[], entryName: string): FeedFacts | undefined {
  const test = graph.definition(testId);
  const tree = graph.input.trees.get(fileOf(testId));
  if (!test || !tree) return undefined;
  const helperNodes = helpers.map((h) => graph.definition(h)).filter((n): n is Node => n !== undefined);
  const feedNames = new Set([entryName, ...helpers.map(ownName)]);
  return testFeeds(test, helperNodes, feedNames, moduleDicts(tree));
}

function readersOf(graph: Graph, entryId: string): EntryFacts["readers"] {
  return graph.closure(entryId).flatMap((id) => {
    const fn = graph.definition(id);
    const start = lineAttr(graph.byId.get(id)!, "startLine");
    return fn ? [{ id, name: nameOf(id), readAt: `${fileOf(id)}:${start}`, facts: readerFacts(fn) }] : [];
  });
}

function entryFacts(graph: Graph, entryId: string, entry: EntryPoint): EntryFacts {
  const feeds = new Map<string, FeedFacts>();
  for (const [testId, helpers] of feedingTests(graph, entryId, entry)) {
    const facts = feedFacts(graph, testId, helpers, ownName(entryId));
    if (facts) feeds.set(testId, facts);
  }
  const tree = graph.input.trees.get(entry.file);
  const fn = graph.definition(entryId);
  const calls = [...feeds.values()].flatMap((f) => f.calls.get(ownName(entryId)) ?? []);
  return {
    entry,
    name: nameOf(entryId),
    readers: readersOf(graph, entryId),
    flags: tree ? fileFlags(tree) : [],
    params: entry.kind === "library" && fn ? paramFacts(fn) : undefined,
    feeds,
    calls,
  };
}

const byClass = (a: InputClass, b: InputClass): number => a.class.localeCompare(b.class) || a.subject.localeCompare(b.subject);

/** For each entry point, which input classes its tests feed and which they never do. */
export function inputClassCensus(input: CensusInput): InputClassCensus {
  const graph = new Graph(input);
  const entries = [...input.entries].sort(([a], [b]) => a.localeCompare(b)).map(([id, entry]): EntryCensus => {
    const facts = entryFacts(graph, id, entry);
    const tests = [...facts.feeds.keys()].map((t) => citation(t, graph.byId)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return { id, kind: entry.kind, tests, classes: classifyGaps(facts).sort(byClass) };
  });
  return { entries, notes: NOTES };
}

/** The census as written to input-classes.json: byte-stable, without the evidence-only fields. */
export function censusJson(census: InputClassCensus): string {
  const entries = census.entries.map((e) => ({
    ...e,
    classes: e.classes.map((c) => ({ class: c.class, subject: c.subject, ...(c.readAt ? { readAt: c.readAt } : {}), fed: c.fed, never: c.never })),
  }));
  return `${JSON.stringify({ entries, notes: census.notes }, null, 2)}\n`;
}


/** Parsed trees of the snapshot's Python files; a file that cannot be read is left out. */
export async function parsePythonTrees(fileIds: readonly string[], root: string): Promise<Map<string, Node>> {
  const trees = new Map<string, Node>();
  for (const id of fileIds) {
    const content = await readFile(path.join(root, id), "utf8").catch(() => undefined);
    if (content !== undefined) trees.set(id, (await parseFile(content, id, "python")).tree.rootNode);
  }
  return trees;
}

export interface EntryAudit {
  entries: ReadonlySet<string>;
  census: InputClassCensus;
  findings: Finding[];
}

/** Entry points of the snapshot's Python files, their input-class census and its findings. */
export async function entryAudit(nodes: readonly GraphNode[], edges: readonly GraphEdge[], isTest: (id: string) => boolean, root: string): Promise<EntryAudit> {
  const pythonFiles = nodes.filter((n) => n.kind === "file" && n.language === "python").map((n) => n.id);
  const trees = await parsePythonTrees(pythonFiles, root);
  const entries = findEntryPoints({ nodes, edges, trees, isTest, root });
  const census = inputClassCensus({ nodes, edges, entries, trees, isTest, root });
  return { entries: new Set(entries.keys()), census, findings: inputClassFindings(census, new Map(nodes.map((n) => [n.id, n]))) };
}
