/**
 * Test-side input facts over tree-sitter Python, for the `entry-input-class` audit signal (C-237):
 * the documents, empty inputs, flags and asserted codes a test supplies. The source side is in
 * audit-input-facts.ts; neither file imports codewatch code.
 */
import type { Node } from "web-tree-sitter";
import {
  argsOf,
  calleeName,
  ERROR_CODE,
  keywordArgs,
  moduleAssignments,
  paramParts,
  positionalArgs,
  stringValue,
  valueClass,
  type ValueClass,
} from "./audit-input-facts.js";

export type Doc = Map<string, ValueClass>;

export interface CallArgs {
  positional: ValueClass[];
  keywords: Map<string, ValueClass>;
}

export interface FeedFacts {
  documents: Doc[];
  empty: boolean;
  literals: Set<string>;
  /**
   * Literals that can set a flag: the test's own, plus a helper's when it takes no parameter of the
   * flag's name (a helper with one, `run(..., execute=True)`, sets it through `kwargs` instead).
   */
  flagSources: { params: Set<string>; literals: Set<string> }[];
  /** Helper keyword defaults overlaid with the keywords the test passes, as source text. */
  kwargs: Map<string, string>;
  asserted: Set<string>;
  calls: Map<string, CallArgs[]>;
}

const EMPTY_FEED_CALLS = new Set(["write_text", "write_bytes"]);

const paramNames = (fn: Node): Set<string> =>
  new Set((fn.childForFieldName("parameters")?.namedChildren ?? []).map((p) => paramParts(p).name).filter((n): n is string => n !== undefined));

const literalsOf = (body: Node): Set<string> =>
  new Set(body.descendantsOfType("string").map(stringValue).filter((s): s is string => s !== undefined));

/** Keyword defaults of a definition, as source text. */
export function keywordDefaults(fn: Node): Map<string, string> {
  const out = new Map<string, string>();
  for (const param of fn.childForFieldName("parameters")?.namedChildren ?? []) {
    const { name, value } = paramParts(param);
    if (name && value) out.set(name, stringValue(value) ?? value.text);
  }
  return out;
}

/** Module-level dict literals of a test file, the bases `dict(NAME, ...)` and `{**NAME}` overlay. */
export function moduleDicts(root: Node): Map<string, Doc> {
  const out = new Map<string, Doc>();
  for (const [name, value] of moduleAssignments(root)) if (value.type === "dictionary") out.set(name, dictDoc(value, out).doc);
  return out;
}

function dictDoc(node: Node, scope: ReadonlyMap<string, Doc>): { doc: Doc; nested: Node[] } {
  const doc: Doc = new Map();
  const nested: Node[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "dictionary_splat") for (const [k, v] of scope.get(child.namedChildren[0]?.text ?? "") ?? []) doc.set(k, v);
    const key = child.type === "pair" ? stringValue(child.childForFieldName("key")) : undefined;
    const value = child.childForFieldName("value");
    if (key === undefined || !value) continue;
    doc.set(key, valueClass(value));
    nested.push(value);
  }
  return { doc, nested };
}

/** `dict(NAME, k=v)`, `dict(NAME)`, `NAME.copy()`, `copy.deepcopy(NAME)` or `{**NAME, ...}`: a copy of a known document. */
function copiedDoc(node: Node, scope: ReadonlyMap<string, Doc>): Doc | undefined {
  if (node.type === "dictionary") return node.namedChildren.some((c) => c.type === "dictionary_splat") ? dictDoc(node, scope).doc : undefined;
  if (node.type !== "call") return undefined;
  const fn = node.childForFieldName("function");
  const base = fn?.type === "attribute" && calleeName(node) === "copy" ? fn.childForFieldName("object") : positionalArgs(node)[0];
  const name = calleeName(node);
  const known = base && (name === "dict" || name === "copy" || name === "deepcopy") ? scope.get(base.text) : undefined;
  if (!known) return undefined;
  const doc = new Map(known);
  if (name === "dict") for (const kw of keywordArgs(node)) doc.set(kw.childForFieldName("name")!.text, valueClass(kw.childForFieldName("value")));
  return doc;
}

function jsonDocs(value: unknown): Doc[] {
  if (Array.isArray(value)) return value.flatMap(jsonDocs);
  if (value === null || typeof value !== "object") return [];
  const entries = Object.entries(value as Record<string, unknown>);
  const classOf = (v: unknown): ValueClass =>
    v === null ? "null" : v === "" || (typeof v === "object" && Object.keys(v as object).length === 0) ? "empty" : "present";
  return [new Map(entries.map(([k, v]) => [k, classOf(v)])), ...entries.flatMap(([, v]) => jsonDocs(v))];
}

function parsedJson(text: string): unknown {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Documents in one body, in statement order: literals, overlays, and bound copies as edited when first passed on. */
class DocumentWalk {
  readonly documents: Doc[] = [];
  private readonly bound = new Map<string, Doc>();
  private readonly passed = new Set<string>();

  constructor(private readonly bases: ReadonlyMap<string, Doc>) {}

  private get scope(): ReadonlyMap<string, Doc> {
    return new Map([...this.bases, ...this.bound]);
  }

  visit(node: Node): void {
    if (this.edit(node)) return;
    const copy = copiedDoc(node, this.scope);
    if (copy) {
      this.documents.push(copy);
      return;
    }
    if (node.type === "dictionary") return this.literal(node);
    const json = node.type === "string" ? parsedJson(stringValue(node) ?? "") : undefined;
    if (json !== undefined) this.documents.push(...jsonDocs(json));
    if (node.type === "identifier" && this.bound.has(node.text) && !this.passed.has(node.text)) {
      this.passed.add(node.text);
      this.documents.push(new Map(this.bound.get(node.text)));
    }
    for (const child of node.namedChildren) this.visit(child);
  }

  private literal(node: Node): void {
    const { doc, nested } = dictDoc(node, this.scope);
    this.documents.push(doc);
    for (const value of nested) this.visit(value);
  }

  /** Bindings and edits of a bound copy; true when the node was consumed. */
  private edit(node: Node): boolean {
    if (node.type === "assignment") return this.assign(node);
    if (node.type === "delete_statement") {
      for (const subscript of node.descendantsOfType("subscript")) {
        const target = this.target(subscript);
        target?.doc.delete(target.key);
      }
      return true;
    }
    const fn = node.type === "call" ? node.childForFieldName("function") : null;
    const owner = fn?.type === "attribute" && calleeName(node) === "pop" ? this.bound.get(fn.childForFieldName("object")?.text ?? "") : undefined;
    const key = owner && stringValue(positionalArgs(node)[0]);
    if (owner && key !== undefined) owner.delete(key);
    return owner !== undefined && key !== undefined;
  }

  private assign(node: Node): boolean {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (!left || !right) return false;
    const set = left.type === "subscript" ? this.target(left) : undefined;
    if (set) {
      set.doc.set(set.key, valueClass(right));
      return true;
    }
    const copy = left.type === "identifier" ? (copiedDoc(right, this.scope) ?? (right.type === "dictionary" ? dictDoc(right, this.scope).doc : undefined)) : undefined;
    if (!copy) return false;
    this.bound.set(left.text, copy);
    this.passed.delete(left.text);
    return true;
  }

  private target(subscript: Node): { doc: Doc; key: string } | undefined {
    const doc = this.bound.get(subscript.childForFieldName("value")?.text ?? "");
    const key = stringValue(subscript.childForFieldName("subscript"));
    return doc && key !== undefined ? { doc, key } : undefined;
  }
}

function callArgs(call: Node): CallArgs {
  const keywords = new Map(keywordArgs(call).map((kw) => [kw.childForFieldName("name")!.text, valueClass(kw.childForFieldName("value"))]));
  return { positional: positionalArgs(call).map(valueClass), keywords };
}

function assertedCodes(body: Node): Set<string> {
  const scopes = [
    ...body.descendantsOfType("assert_statement"),
    ...body.descendantsOfType("call").filter((c) => /^(?:assert|raises$)/.test(calleeName(c) ?? "")),
  ];
  const codes = scopes.flatMap((s) => s.descendantsOfType("string").map(stringValue));
  return new Set(codes.filter((s): s is string => s !== undefined && ERROR_CODE.test(s)));
}

function feedsEmpty(calls: readonly Node[], feedNames: ReadonlySet<string>, literals: ReadonlySet<string>): boolean {
  const emptyArg = (c: Node): boolean => {
    const name = calleeName(c) ?? "";
    const args = feedNames.has(name) || EMPTY_FEED_CALLS.has(name) ? argsOf(c).map((a) => a.childForFieldName("value") ?? a) : [];
    const input = keywordArgs(c).find((kw) => kw.childForFieldName("name")?.text === "input");
    return [...args, ...(input ? [input.childForFieldName("value")!] : [])].some((a) => valueClass(a) === "empty");
  };
  return calls.some(emptyArg) || literals.has("[]") || literals.has("{}");
}

function explicitKwargs(calls: readonly Node[], names: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const call of calls.filter((c) => names.has(calleeName(c) ?? ""))) {
    for (const kw of keywordArgs(call)) {
      const value = kw.childForFieldName("value")!;
      out.set(kw.childForFieldName("name")!.text, stringValue(value) ?? value.text);
    }
  }
  return out;
}

/**
 * What one test supplies, from its own body and the same-file helpers it calls: `feedNames` are
 * the entry's and those helpers' names, and `bases` the file's module-level dicts.
 */
export function testFeeds(test: Node, helpers: readonly Node[], feedNames: ReadonlySet<string>, bases: ReadonlyMap<string, Doc>): FeedFacts {
  const bodies = [test, ...helpers];
  const documents = bodies.flatMap((body) => {
    const walk = new DocumentWalk(bases);
    walk.visit(body);
    return walk.documents;
  });
  const calls = bodies.flatMap((b) => b.descendantsOfType("call"));
  const literals = new Set(bodies.flatMap((b) => [...literalsOf(b)]));
  const flagSources = [{ params: new Set<string>(), literals: literalsOf(test) }, ...helpers.map((h) => ({ params: paramNames(h), literals: literalsOf(h) }))];
  const kwargs = new Map([...helpers.flatMap((h) => [...keywordDefaults(h)]), ...explicitKwargs(test.descendantsOfType("call"), feedNames)]);
  const byCallee = new Map<string, CallArgs[]>();
  for (const call of calls) byCallee.set(calleeName(call) ?? "", [...(byCallee.get(calleeName(call) ?? "") ?? []), callArgs(call)]);
  const empty = feedsEmpty(calls, feedNames, literals) || documents.some((d) => [...d.values()].includes("empty"));
  return { documents, empty, literals, flagSources, kwargs, asserted: new Set(bodies.flatMap((b) => [...assertedCodes(b)])), calls: byCallee };
}
