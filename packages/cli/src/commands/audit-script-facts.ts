/**
 * Process-boundary contract facts of a script, for the `contract-change` audit signal (C-236 B):
 * its entry guard, the exit codes it can end with and the flags it accepts. Pure functions over
 * a tree-sitter Python or TypeScript-grammar tree (`.mjs`/`.cjs`/`.js` parse as TypeScript).
 */
import type { ParsedFile } from "@titan-design/code-parser";
import type { Node } from "web-tree-sitter";
import { lastName, staticText, walk } from "./audit-contract-facts.js";

export interface ScriptFacts {
  /** The entry guard's line, or 1 for a script that only has a `#!` line. */
  guardLine: number;
  exitCodes: number[];
  flags: string[];
}

const FLAG = /^--[a-z][a-z0-9-]*$/;
const PY_MAIN = /^__name__==(["'])__main__\1$|^(["'])__main__\2==__name__$/;
const FUNCTIONS = new Set(["function_declaration", "function_definition", "function_expression", "arrow_function", "method_definition"]);
const CONDITIONALS = new Set(["ternary_expression", "conditional_expression"]);

const lineOf = (node: Node): number => node.startPosition.row + 1;
const compact = (text: string): string => text.replace(/\s+/g, "");
const argumentsOf = (call: Node): Node[] => call.childForFieldName("arguments")?.namedChildren.filter((a) => a.type !== "comment") ?? [];
const isCall = (node: Node): boolean => node.type === "call" || node.type === "call_expression";
const sameNode = (a: Node, b: Node | null): boolean => b !== null && a.startIndex === b.startIndex && a.endIndex === b.endIndex;

function isGuardCondition(condition: string): boolean {
  if (PY_MAIN.test(condition)) return true;
  if (condition.includes("process.argv[1]") && condition.includes("import.meta.url")) return true;
  return condition.includes("import.meta.main") || condition.includes("require.main===module") || condition.includes("module===require.main");
}

/** The line of a module-level entry guard, else 1 for a `#!` line, else undefined. */
export function guardLineOf(file: ParsedFile): number | undefined {
  for (const statement of file.tree.rootNode.namedChildren) {
    if (statement.type !== "if_statement") continue;
    const condition = statement.childForFieldName("condition");
    if (condition && isGuardCondition(compact(condition.text).replace(/^\((.*)\)$/, "$1"))) return lineOf(statement);
  }
  return file.content.startsWith("#!") ? 1 : undefined;
}

/** Same-file functions by name: declarations and `const f = () => ...`. */
function functionTable(file: ParsedFile): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const node of walk(file.tree.rootNode)) {
    const value = node.type === "variable_declarator" ? node.childForFieldName("value") : node;
    const name = node.childForFieldName("name")?.text;
    if (value && name && FUNCTIONS.has(value.type) && !out.has(name)) out.set(name, value);
  }
  return out;
}

/** Return values of `fn` itself, nested functions excluded; an expression-bodied arrow returns its body. */
function returnValues(fn: Node): Node[] {
  const body = fn.childForFieldName("body");
  if (!body) return [];
  if (body.type !== "statement_block" && body.type !== "block") return [body];
  const out: Node[] = [];
  const visit = (node: Node): void => {
    for (const child of node.namedChildren) {
      if (FUNCTIONS.has(child.type)) continue;
      if (child.type === "return_statement" && child.namedChildren[0]) out.push(child.namedChildren[0]);
      visit(child);
    }
  };
  visit(body);
  return out;
}

/** Integer codes an exit argument can take: literals, each conditional branch, and one hop into a same-file function's returns. */
function codesOf(node: Node | undefined, table: ReadonlyMap<string, Node> | undefined): number[] {
  if (!node) return [];
  if ((node.type === "integer" || node.type === "number") && Number.isInteger(Number(node.text))) return [Number(node.text)];
  if (node.type === "parenthesized_expression") return codesOf(node.namedChildren[0], table);
  if (CONDITIONALS.has(node.type)) {
    const [first, , third] = node.namedChildren;
    const branches = node.type === "ternary_expression" ? [node.childForFieldName("consequence"), node.childForFieldName("alternative")] : [first, third];
    return branches.flatMap((b) => codesOf(b ?? undefined, table));
  }
  const callee = isCall(node) ? node.childForFieldName("function") : null;
  const fn = table && callee?.type === "identifier" ? table.get(callee.text) : undefined;
  return fn ? returnValues(fn).flatMap((value) => codesOf(value, undefined)) : [];
}

/** The argument an exit site ends the process with; null when the node is no exit site. */
function exitArgument(node: Node): Node | undefined | null {
  if (isCall(node)) {
    const callee = node.childForFieldName("function");
    const receiver = callee?.childForFieldName("object")?.text;
    return lastName(callee) === "exit" && (receiver === "sys" || receiver === "process") ? argumentsOf(node)[0] : null;
  }
  if (node.type === "assignment_expression" && compact(node.childForFieldName("left")?.text ?? "") === "process.exitCode") {
    return node.childForFieldName("right") ?? undefined;
  }
  const raised = node.type === "raise_statement" ? node.namedChildren[0] : undefined;
  return raised && isCall(raised) && lastName(raised.childForFieldName("function")) === "SystemExit" ? argumentsOf(raised)[0] : null;
}

function isSystemExit(raise: Node): boolean {
  const value = raise.namedChildren[0];
  return lastName(value && isCall(value) ? value.childForFieldName("function") : value) === "SystemExit";
}

/** A throw or raise outside every try body ends the process with 1. */
function isUncaught(node: Node): boolean {
  if (node.type !== "throw_statement" && (node.type !== "raise_statement" || isSystemExit(node))) return false;
  for (let at: Node = node; at.parent; at = at.parent) {
    if (at.parent.type === "try_statement" && sameNode(at, at.parent.childForFieldName("body"))) return false;
  }
  return true;
}

function exitCodes(file: ParsedFile): number[] {
  const table = functionTable(file);
  const codes = new Set([0]);
  for (const node of walk(file.tree.rootNode)) {
    const arg = exitArgument(node);
    if (arg !== null) for (const code of codesOf(arg, table)) codes.add(code);
    if (isUncaught(node)) codes.add(1);
  }
  return [...codes].sort((a, b) => a - b);
}

/** `--key` for each key of the `options` object passed to `parseArgs({ options })`. */
function parseArgsFlags(call: Node): string[] {
  const options = argumentsOf(call)[0]?.namedChildren.find((p) => p.type === "pair" && p.childForFieldName("key")?.text === "options");
  const value = options?.childForFieldName("value");
  if (value?.type !== "object") return [];
  return value.namedChildren.flatMap((pair) => {
    const key = pair.type === "pair" ? pair.childForFieldName("key") : null;
    const name = key && (staticText(key) ?? key.text);
    return name ? [`--${name}`] : [];
  });
}

function callFlags(call: Node): string[] {
  const callee = call.childForFieldName("function");
  const name = lastName(callee);
  if (name === "parseArgs") return parseArgsFlags(call);
  const argvIncludes = name === "includes" && /argv/.test(callee?.childForFieldName("object")?.text ?? "");
  if (!argvIncludes && name !== "add_argument") return [];
  return argumentsOf(call).flatMap((arg) => {
    const text = staticText(arg);
    return text === undefined ? [] : [text];
  });
}

function acceptedFlags(file: ParsedFile): string[] {
  const flags = new Set<string>();
  for (const node of walk(file.tree.rootNode)) if (isCall(node)) for (const flag of callFlags(node)) if (FLAG.test(flag)) flags.add(flag);
  return [...flags].sort();
}

/** Exit codes and flags of a file, whether or not it has an entry guard. */
export function contractOf(file: ParsedFile): Omit<ScriptFacts, "guardLine"> {
  return { exitCodes: exitCodes(file), flags: acceptedFlags(file) };
}

/** A script's process contract, or undefined for a module with no entry guard. */
export function scriptFacts(file: ParsedFile): ScriptFacts | undefined {
  const guardLine = guardLineOf(file);
  return guardLine === undefined ? undefined : { guardLine, ...contractOf(file) };
}
