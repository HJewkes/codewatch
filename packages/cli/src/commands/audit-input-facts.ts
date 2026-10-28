/**
 * Static input facts over tree-sitter Python, for the `entry-input-class` audit signal (C-237).
 * Source side: the keys, error codes, flags and parameters a reader uses; audit-input-feeds.ts
 * holds the test side. Pure functions over parsed trees with no codewatch imports, so the two
 * files can move into code-graph unchanged.
 */
import type { Node } from "web-tree-sitter";

export type KeyRead = "checked" | "default" | "required";
export type ValueClass = "present" | "null" | "empty";

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

export const ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const MAIN_GUARD = /^__name__\s*==\s*["']__main__["']$|^["']__main__["']\s*==\s*__name__$/;
const ITERATING_CALLS = new Set(["len", "sum", "max", "min", "sorted", "any", "all", "list", "set", "tuple"]);
const ITERABLE_TYPE = /^(?:typing\.)?(?:list|dict|set|tuple|str|Sequence|Iterable|Mapping|List|Dict|Set|Tuple)\b/;
const OPTIONAL_TYPE = /Optional\[|\|\s*None\b|\bNone\s*\|/;

/** A string literal's content, or undefined for any other node or an f-string. */
export function stringValue(node: Node | null | undefined): string | undefined {
  if (node?.type !== "string" || node.namedChildren.some((c) => c.type === "interpolation")) return undefined;
  return node.namedChildren.filter((c) => c.type === "string_content" || c.type === "escape_sequence").map((c) => c.text).join("");
}

export function calleeName(call: Node): string | undefined {
  const fn = call.childForFieldName("function");
  if (fn?.type === "identifier") return fn.text;
  return fn?.type === "attribute" ? fn.childForFieldName("attribute")?.text : undefined;
}

export const argsOf = (call: Node): Node[] => call.childForFieldName("arguments")?.namedChildren.filter((c) => c.type !== "comment") ?? [];
export const positionalArgs = (call: Node): Node[] => argsOf(call).filter((a) => a.type !== "keyword_argument");
export const keywordArgs = (call: Node): Node[] => argsOf(call).filter((a) => a.type === "keyword_argument");

export function valueClass(node: Node | null): ValueClass {
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

const FLAG_LITERAL = /^--([a-z][a-z0-9-]*)$/;

/** Hand-rolled argv checks, `a == "--flag"` or `"--flag" in argv`: a boolean mode each. */
function comparedFlags(root: Node): string[] {
  const compared = root.descendantsOfType("comparison_operator").filter((c) =>
    c.childrenForFieldName("operators").some((o) => o.type === "==" || o.type === "in"),
  );
  return compared.flatMap((c) => c.namedChildren.map((n) => FLAG_LITERAL.exec(stringValue(n) ?? "")?.[1]).filter((f): f is string => f !== undefined));
}

/** A file's flags that give a mode: `add_argument` booleans and choices, then hand-rolled boolean checks. */
export function fileFlags(root: Node): FlagFact[] {
  const declared = root.descendantsOfType("call").filter((c) => calleeName(c) === "add_argument").map(flagOf).filter((f): f is FlagFact => f !== undefined);
  const names = new Set(declared.map((f) => f.name));
  const compared = [...new Set(comparedFlags(root))].filter((name) => !names.has(name)).map((name) => ({ name, boolean: true, choices: [] }));
  return [...declared, ...compared];
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

export function moduleAssignments(root: Node): [string, Node][] {
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

export function paramParts(param: Node): { name?: string; type?: string; value?: Node } {
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
