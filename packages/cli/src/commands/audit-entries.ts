import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSymbolId, type GraphEdge, type GraphNode } from "@titan-design/code-graph";
import type { Node } from "web-tree-sitter";
import { mainGuardCallees, moduleAll } from "./audit-input-facts.js";

export type EntryKind = "cli" | "library";

export interface EntryPoint {
  kind: EntryKind;
  file: string;
}

export interface EntryInput {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Parsed Python files by file id. */
  trees: ReadonlyMap<string, Node>;
  isTest: (id: string) => boolean;
  root: string;
}

const TEST_FILE = /(?:^|\/)(?:tests?\/|test_[^/]*\.py$|[^/]*_test\.py$|conftest\.py$)/;
const SCRIPT_SECTIONS = new Set(["[project.scripts]", "[tool.poetry.scripts]"]);
const HTTP_HANDLER = /\.do_(?:GET|POST|PUT|DELETE|PATCH)$/;
const MAIN_MODULE = /(?:^|\/)__main__\.py$/;

/** A test file holds a test function or matches code-graph's test path pattern. */
export function testFileIds(nodes: readonly GraphNode[], isTest: (id: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "file" && TEST_FILE.test(n.id)) out.add(n.id);
    const fileId = n.kind === "symbol" && isTest(n.id) ? parseSymbolId(n.id)?.fileId : undefined;
    if (fileId) out.add(fileId);
  }
  return out;
}

export const isSourceFile = (fileId: string | undefined, testFiles: ReadonlySet<string>): boolean =>
  fileId !== undefined && fileId.endsWith(".py") && !testFiles.has(fileId);

/** `module:attr` targets of a pyproject's console scripts, as code-graph reads them. */
export function consoleScripts(pyproject: string): { name: string; target: string }[] {
  const out: { name: string; target: string }[] = [];
  let inSection = false;
  for (const raw of pyproject.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) inSection = SCRIPT_SECTIONS.has(line);
    const match = inSection ? /^([\w.-]+)\s*=\s*["']([\w.]+:[\w.]+)["']/.exec(line) : null;
    if (match) out.push({ name: match[1]!, target: match[2]! });
  }
  return out;
}

export function readConsoleScripts(root: string): { name: string; target: string }[] {
  const file = path.join(root, "pyproject.toml");
  return existsSync(file) ? consoleScripts(readFileSync(file, "utf8")) : [];
}

const moduleOf = (fileId: string): string => fileId.replace(/\.py$/, "").replace(/\/__init__$/, "").replaceAll("/", ".");

function scriptEntries(sources: readonly string[], root: string): string[] {
  const targets = readConsoleScripts(root).map((s) => s.target.split(":"));
  return sources.filter((id) => {
    const parsed = parseSymbolId(id);
    return targets.some(([mod, attr]) => parsed?.name === attr && (moduleOf(parsed.fileId) === mod || moduleOf(parsed.fileId).endsWith(`.${mod}`)));
  });
}

function guardEntries(input: EntryInput, sources: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const [fileId, tree] of input.trees) {
    const callees = mainGuardCallees(tree);
    for (const e of input.edges) {
      const fromModule = e.kind === "calls" && e.srcId === fileId && sources.has(e.dstId);
      const name = parseSymbolId(e.dstId)?.name;
      if (fromModule && (MAIN_MODULE.test(fileId) || (name !== undefined && callees.has(name)))) out.push(e.dstId);
    }
  }
  return out;
}

function cliEntries(input: EntryInput, sources: ReadonlySet<string>): Set<string> {
  const handlers = [...sources].filter((id) => HTTP_HANDLER.test(parseSymbolId(id)?.name ?? ""));
  return new Set([...scriptEntries([...sources], input.root), ...guardEntries(input, sources), ...handlers]);
}

const privateSegment = (segment: string): boolean => segment.startsWith("_") && !/^__\w+__(?:\.py)?$/.test(segment);

function isPublic(id: string, trees: ReadonlyMap<string, Node>): boolean {
  const parsed = parseSymbolId(id);
  if (!parsed || [...parsed.fileId.split("/"), ...parsed.name.split(".")].some(privateSegment)) return false;
  const tree = trees.get(parsed.fileId);
  const listed = tree && moduleAll(tree);
  return listed === undefined || listed.has(parsed.name);
}

/**
 * Public entry points: CLI entries (console scripts, `__main__` guards and modules, HTTP handler
 * methods), else, only when the repo has none, the public functions tests call directly.
 */
export function findEntryPoints(input: EntryInput): Map<string, EntryPoint> {
  const testFiles = testFileIds(input.nodes, input.isTest);
  const sourceIds = input.nodes
    .filter((n) => n.kind === "symbol" && isSourceFile(parseSymbolId(n.id)?.fileId, testFiles))
    .map((n) => n.id);
  const sources = new Set(sourceIds);
  const cli = cliEntries(input, sources);
  const library = input.edges
    .filter((e) => e.kind === "calls" && input.isTest(e.srcId) && sources.has(e.dstId) && isPublic(e.dstId, input.trees))
    .map((e) => e.dstId);
  const chosen: [EntryKind, Iterable<string>] = cli.size > 0 ? ["cli", cli] : ["library", library];
  const entries = new Map<string, EntryPoint>();
  for (const id of [...chosen[1]].sort()) entries.set(id, { kind: chosen[0], file: parseSymbolId(id)!.fileId });
  return entries;
}
