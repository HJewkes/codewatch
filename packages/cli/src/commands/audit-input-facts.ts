/**
 * Static input facts over tree-sitter Python, for the `entry-input-class` audit signal (C-237).
 * Source side: the keys, error codes, flags and parameters a reader uses. Test side: the
 * documents, empty inputs, flags and asserted codes a test supplies. Pure functions over parsed
 * trees, kept in one file so the extraction can move into code-graph unchanged.
 */
import type { Node } from "web-tree-sitter";

export type KeyRead = "checked" | "default" | "required";
export type ValueClass = "present" | "null" | "empty";
export type Doc = Map<string, ValueClass>;

export interface ReaderFacts {
  keys: Map<string, KeyRead>;
  codes: Set<string>;
}

export interface FlagFact {
  name: string;
  boolean: boolean;
  choices: string[];
}

export interface ParamFacts {
  names: string[];
  iterated: string[];
  nullable: string[];
}

export interface CallArgs {
  positional: ValueClass[];
  keywords: Map<string, ValueClass>;
}

export interface FeedFacts {
  documents: Doc[];
  empty: boolean;
  literals: Set<string>;
  /** Helper keyword defaults overlaid with the keywords the test passes, as source text. */
  kwargs: Map<string, string>;
  asserted: Set<string>;
  calls: Map<string, CallArgs[]>;
}

const ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const MAIN_GUARD = /^__name__\s*==\s*["']__main__["']$|^["']__main__["']\s*==\s*__name__$/;
const ITERATING_CALLS = new Set(["len", "sum", "max", "min", "sorted", "any", "all", "list", "set", "tuple"]);
const ITERABLE_TYPE = /^(?:typing\.)?(?:list|dict|set|tuple|str|Sequence|Iterable|Mapping|List|Dict|Set|Tuple)\b/;
const OPTIONAL_TYPE = /Optional\[|\|\s*None\b|\bNone\s*\|/;
const EMPTY_FEED_CALLS = new Set(["write_text", "write_bytes"]);

/** A string literal's content, or undefined for any other node or an f-string. */
export function stringValue(node: Node | null | undefined): string | undefined {
  if (node?.type !== "string" || node.namedChildren.some((c) => c.type === "interpolation")) return undefined;
  return node.namedChildren.filter((c) => c.type === "string_content" || c.type === "escape_sequence").map((c) => c.text).join("");
}

function calleeName(call: Node): string | undefined {
  const fn = call.childForFieldName("function");
  if (fn?.type === "identifier") return fn.text;
  return fn?.type === "attribute" ? fn.childForFieldName("attribute")?.text : undefined;
}

const argsOf = (call: Node): Node[] => call.childForFieldName("arguments")?.namedChildren.filter((c) => c.type !== "comment") ?? [];
const positionalArgs = (call: Node): Node[] => argsOf(call).filter((a) => a.type !== "keyword_argument");
const keywordArgs = (call: Node): Node[] => argsOf(call).filter((a) => a.type === "keyword_argument");

function valueClass(node: Node | null): ValueClass {
  if (!node || node.type === "none") return "null";
  if (node.type === "string") return stringValue(node) === "" ? "empty" : "present";
  if (["list", "tuple", "dictionary", "set"].includes(node.type)) return node.namedChildren.some((c) => c.type !== "comment") ? "present" : "empty";
  if (node.type === "call" && ["dict", "list", "set", "tuple"].includes(calleeName(node) ?? "")) return argsOf(node).length === 0 ? "empty" : "present";
  return "present";
}

function readKey(keys: Map<string, KeyRead>, node: Node): void {
  if (node.type === "call" && calleeName(node) === "get" && node.childForFieldName("function")?.type === "attribute") {
    const [key, fallback] = positionalArgs(node);
    const name = stringValue(key);
    if (name !== undefined && !keys.has(name)) keys.set(name, fallback ? "default" : "checked");
  } else if (node.type === "comparison_operator" && node.childrenForFieldName("operators").some((o) => o.type === "in" || o.type === "not in")) {
    const name = stringValue(node.namedChildren[0]);
    if (name !== undefined) keys.set(name, "checked");
  } else if (node.type === "subscript") {
    const name = stringValue(node.childForFieldName("subscript"));
    if (name !== undefined && !keys.has(name)) keys.set(name, "required");
  }
}

/** The literal keys a function reads and the error-code constants it holds. */
export function readerFacts(fn: Node): ReaderFacts {
  const facts: ReaderFacts = { keys: new Map(), codes: new Set() };
  const visit = (node: Node): void => {
    readKey(facts.keys, node);
    const text = stringValue(node);
    if (text !== undefined && ERROR_CODE.test(text)) facts.codes.add(text);
    for (const child of node.namedChildren) visit(child);
  };
  visit(fn);
  return facts;
}

function flagOf(call: Node): FlagFact | undefined {
  const name = stringValue(positionalArgs(call)[0]);
  if (name === undefined || !name.startsWith("--")) return undefined;
  const flag: FlagFact = { name: name.slice(2), boolean: false, choices: [] };
  for (const kw of keywordArgs(call)) {
    const value = kw.childForFieldName("value");
    const key = kw.childForFieldName("name")?.text;
    if (key === "action") flag.boolean = /^store_(?:true|false)$/.test(stringValue(value) ?? "");
    if (key === "choices") flag.choices = (value?.namedChildren ?? []).map(stringValue).filter((s): s is string => s !== undefined);
  }
  return flag.boolean || flag.choices.length > 0 ? flag : undefined;
}

/** `add_argument("--flag", ...)` calls in a file that give a boolean mode or a set of choices. */
export function fileFlags(root: Node): FlagFact[] {
  return root.descendantsOfType("call").filter((c) => calleeName(c) === "add_argument").map(flagOf).filter((f): f is FlagFact => f !== undefined);
}

/** Names a module-level `if __name__ == "__main__":` block calls. */
export function mainGuardCallees(root: Node): Set<string> {
  const out = new Set<string>();
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "if_statement" || !MAIN_GUARD.test(stmt.childForFieldName("condition")?.text ?? "")) continue;
    for (const call of stmt.descendantsOfType("call")) {
      const fn = call.childForFieldName("function");
      if (fn?.type === "identifier") out.add(fn.text);
    }
  }
  return out;
}

function moduleAssignments(root: Node): [string, Node][] {
  const out: [string, Node][] = [];
  for (const stmt of root.namedChildren) {
    const expr = stmt.type === "expression_statement" ? stmt.namedChildren[0] : undefined;
    const left = expr?.type === "assignment" ? expr.childForFieldName("left") : undefined;
    const right = expr?.childForFieldName("right");
    if (left?.type === "identifier" && right) out.push([left.text, right]);
  }
  return out;
}

/** The names a module's `__all__` lists, or undefined when it defines none. */
export function moduleAll(root: Node): Set<string> | undefined {
  const value = moduleAssignments(root).find(([name]) => name === "__all__")?.[1];
  return value && new Set(value.namedChildren.map(stringValue).filter((s): s is string => s !== undefined));
}

/** The function or method definition a graph symbol names, found by its own name inside its line span. */
export function findDefinition(root: Node, name: string, startLine: number, endLine: number): Node | undefined {
  const own = name.split(".").at(-1);
  return root.descendantsOfType("function_definition").find((fn) => {
    const line = fn.startPosition.row + 1;
    return fn.childForFieldName("name")?.text === own && line >= startLine && line <= endLine;
  });
}

function paramParts(param: Node): { name?: string; type?: string; value?: Node } {
  if (param.type === "identifier") return { name: param.text };
  const name = param.childForFieldName("name")?.text ?? param.namedChildren.find((c) => c.type === "identifier")?.text;
  return { name, type: param.childForFieldName("type")?.text, value: param.childForFieldName("value") ?? undefined };
}

function iteratesOver(body: Node, name: string): boolean {
  const looped = body.descendantsOfType("for_statement").some((f) => f.childForFieldName("right")?.text === name);
  const passed = body.descendantsOfType("call").some((c) => ITERATING_CALLS.has(calleeName(c) ?? "") && positionalArgs(c)[0]?.text === name);
  return looped || passed;
}

/** A definition's parameters (without self or cls), which it iterates and which may be None. */
export function paramFacts(fn: Node): ParamFacts {
  const body = fn.childForFieldName("body");
  const facts: ParamFacts = { names: [], iterated: [], nullable: [] };
  for (const param of fn.childForFieldName("parameters")?.namedChildren ?? []) {
    const { name, type, value } = paramParts(param);
    if (!name || name === "self" || name === "cls") continue;
    facts.names.push(name);
    if (ITERABLE_TYPE.test(type ?? "") || (body && iteratesOver(body, name))) facts.iterated.push(name);
    if (value?.type === "none" || OPTIONAL_TYPE.test(type ?? "")) facts.nullable.push(name);
  }
  return facts;
}

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
  const literals = new Set(bodies.flatMap((b) => b.descendantsOfType("string").map(stringValue)).filter((s): s is string => s !== undefined));
  const kwargs = new Map([...helpers.flatMap((h) => [...keywordDefaults(h)]), ...explicitKwargs(test.descendantsOfType("call"), feedNames)]);
  const byCallee = new Map<string, CallArgs[]>();
  for (const call of calls) byCallee.set(calleeName(call) ?? "", [...(byCallee.get(calleeName(call) ?? "") ?? []), callArgs(call)]);
  const empty = feedsEmpty(calls, feedNames, literals) || documents.some((d) => [...d.values()].includes("empty"));
  return { documents, empty, literals, kwargs, asserted: new Set(bodies.flatMap((b) => [...assertedCodes(b)])), calls: byCallee };
}
