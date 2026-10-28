/**
 * Contract facts over tree-sitter Python and TypeScript, for the `contract-change` audit signal
 * (C-236): the error sites a file holds and the parameter list of the callable at a line. Pure
 * functions over parsed trees with no codewatch imports, so the file can move into code-graph
 * as symbol attrs unchanged.
 */
import type { ParsedFile } from "@titan-design/code-parser";
import type { Node } from "web-tree-sitter";
import { ERROR_CODE } from "./audit-input-facts.js";

export interface ErrorSite {
  line: number;
  /** Constructor name, the raiser's raised constructor, or `exit` for an exit call. */
  exception: string;
  /** First string argument (whitespace collapsed), else an error-code constant, else empty; the code for an exit. */
  message: string;
  /** The same-file raiser this site calls, when it is a raiser call. */
  via?: string;
}

export interface Param {
  name: string;
  positional: boolean;
  required: boolean;
  default?: string;
}

export const errorKey = (site: Pick<ErrorSite, "exception" | "message">): string => `${site.exception}:${site.message}`;

const PY_FUNCTIONS = new Set(["function_definition"]);
const TS_FUNCTIONS = new Set(["function_declaration", "generator_function_declaration", "method_definition", "arrow_function", "function_expression", "function"]);
const CLASSES = new Set(["class_definition", "class_declaration", "class"]);
const RAISES = new Set(["raise_statement", "throw_statement"]);
const STRING_PARTS = new Set(["string_content", "string_fragment", "escape_sequence"]);

const isPython = (file: ParsedFile): boolean => file.language === "python";
const functionTypes = (file: ParsedFile): ReadonlySet<string> => (isPython(file) ? PY_FUNCTIONS : TS_FUNCTIONS);
const named = (node: Node | null | undefined): Node[] => node?.namedChildren.filter((c) => c.type !== "comment") ?? [];
const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
const lineOf = (node: Node): number => node.startPosition.row + 1;

export function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.namedChildren) yield* walk(child);
}

/** The callee's last name segment: `f`, `self.f` and `this.f` all give `f`. */
export function lastName(node: Node | null | undefined): string | undefined {
  if (node?.type === "identifier" || node?.type === "property_identifier") return node.text;
  if (node?.type === "attribute") return node.childForFieldName("attribute")?.text;
  if (node?.type === "member_expression") return node.childForFieldName("property")?.text;
  return undefined;
}

/** A string's static text up to its first interpolation, or undefined for any other node. */
export function staticText(node: Node): string | undefined {
  if (node.type !== "string" && node.type !== "template_string") return undefined;
  const parts: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "interpolation" || child.type === "template_substitution") break;
    if (STRING_PARTS.has(child.type)) parts.push(child.text);
  }
  return parts.join("");
}

const upTo = (text: string | undefined, stop: string): string | undefined => (text === undefined ? undefined : text.split(stop)[0]);

/** Static text of a message built by `%`, `+` or `.format`, up to the first placeholder. */
function formattedText(node: Node): string | undefined {
  if (node.type === "binary_operator" || node.type === "binary_expression") {
    const left = node.childForFieldName("left");
    const operator = node.childForFieldName("operator")?.text;
    if (!left || (operator !== "%" && operator !== "+")) return undefined;
    return operator === "%" ? upTo(staticText(left), "%") : (staticText(left) ?? formattedText(left));
  }
  const callee = node.type === "call" ? node.childForFieldName("function") : null;
  const target = callee?.type === "attribute" && lastName(callee) === "format" ? callee.childForFieldName("object") : null;
  return target ? upTo(staticText(target), "{") : undefined;
}

function messageOf(args: readonly Node[]): string {
  for (const arg of args) {
    const text = staticText(arg) ?? formattedText(arg);
    if (text !== undefined) return collapse(text);
  }
  const code = args.map((a) => lastName(a) ?? a.text).find((t) => ERROR_CODE.test(t));
  return code ?? "";
}

const argumentsOf = (call: Node): Node[] => named(call.childForFieldName("arguments")).filter((a) => a.type !== "keyword_argument");

/** A non-zero exit code literal, or a string message; undefined for 0, no argument or anything computed. */
function exitCode(arg: Node | undefined): string | undefined {
  if (!arg) return undefined;
  if (arg.type === "integer" || arg.type === "number") return Number(arg.text) === 0 ? undefined : arg.text;
  if (arg.type === "unary_operator" || arg.type === "unary_expression") return arg.text.replace(/\s+/g, "");
  const text = staticText(arg);
  return text === undefined ? undefined : collapse(text);
}

function exitSite(line: number, arg: Node | undefined): ErrorSite | undefined {
  const code = exitCode(arg);
  return code === undefined ? undefined : { line, exception: "exit", message: code };
}

/** The raised value's constructor or bare name, with its message; `raise SystemExit(n)` is an exit. */
function raisedSite(raise: Node): ErrorSite | undefined {
  const value = named(raise)[0];
  if (!value) return undefined;
  const line = lineOf(raise);
  if (value.type === "call" || value.type === "new_expression" || value.type === "call_expression") {
    const exception = lastName(value.childForFieldName("function") ?? value.childForFieldName("constructor"));
    if (exception === "SystemExit") return exitSite(line, argumentsOf(value)[0]);
    return exception === undefined ? undefined : { line, exception, message: messageOf(argumentsOf(value)) };
  }
  const exception = lastName(value);
  if (exception === "SystemExit") return undefined;
  return exception === undefined ? undefined : { line, exception, message: "" };
}

function hasReturn(body: Node, functions: ReadonlySet<string>): boolean {
  const visit = (node: Node): boolean =>
    node.type === "return_statement" || node.namedChildren.some((c) => !functions.has(c.type) && visit(c));
  return visit(body);
}

/** The exception a function always raises: its last top-level statement raises and it never returns. */
function raiserException(fn: Node, functions: ReadonlySet<string>): string | undefined {
  const body = fn.childForFieldName("body");
  const last = named(body).at(-1);
  if (!body || !last || !RAISES.has(last.type) || hasReturn(body, functions)) return undefined;
  const site = raisedSite(last);
  return site?.exception === "exit" ? undefined : site?.exception;
}

const enclosingClass = (node: Node): string | undefined => {
  for (let up = node.parent; up; up = up.parent) if (CLASSES.has(up.type)) return up.childForFieldName("name")?.text ?? "";
  return undefined;
};

/** Raisers by `Class.name` (methods) and `.name` (module-level functions). */
function raisers(file: ParsedFile): Map<string, string> {
  const functions = functionTypes(file);
  const out = new Map<string, string>();
  for (const node of walk(file.tree.rootNode)) {
    const name = node.childForFieldName("name")?.text;
    const exception = functions.has(node.type) && name ? raiserException(node, functions) : undefined;
    if (exception !== undefined) out.set(`${enclosingClass(node) ?? ""}.${name}`, exception);
  }
  return out;
}

function resolveRaiser(call: Node, table: ReadonlyMap<string, string>): { name: string; exception: string } | undefined {
  const callee = call.childForFieldName("function");
  const name = lastName(callee);
  if (!callee || name === undefined) return undefined;
  const receiver = callee.childForFieldName("object")?.text;
  if (callee.type === "identifier") return table.has(`.${name}`) ? { name, exception: table.get(`.${name}`)! } : undefined;
  if (receiver !== "self" && receiver !== "this") return undefined;
  const own = table.get(`${enclosingClass(call) ?? ""}.${name}`);
  const any = [...table].find(([key]) => key.endsWith(`.${name}`) && !key.startsWith("."))?.[1];
  const exception = own ?? any;
  return exception === undefined ? undefined : { name, exception };
}

function isExitCall(call: Node): boolean {
  const callee = call.childForFieldName("function");
  const receiver = callee?.childForFieldName("object")?.text;
  return lastName(callee) === "exit" && (receiver === "sys" || receiver === "process");
}

function callSite(call: Node, table: ReadonlyMap<string, string>): ErrorSite | undefined {
  if (isExitCall(call)) return exitSite(lineOf(call), argumentsOf(call)[0]);
  const raiser = resolveRaiser(call, table);
  if (!raiser) return undefined;
  return { line: lineOf(call), exception: raiser.exception, message: messageOf(argumentsOf(call)), via: raiser.name };
}

function exitCodeAssignment(node: Node): ErrorSite | undefined {
  if (node.childForFieldName("left")?.text.replace(/\s+/g, "") !== "process.exitCode") return undefined;
  const right = node.childForFieldName("right") ?? undefined;
  return right?.type === "number" ? exitSite(lineOf(node), right) : undefined;
}

/** Every raise, throw, non-zero exit and same-file raiser call in the file, in source order. */
export function errorSites(file: ParsedFile): ErrorSite[] {
  const table = raisers(file);
  const sites: ErrorSite[] = [];
  for (const node of walk(file.tree.rootNode)) {
    let site: ErrorSite | undefined;
    if (RAISES.has(node.type)) site = raisedSite(node);
    else if (node.type === "call" || node.type === "call_expression") site = callSite(node, table);
    else if (node.type === "assignment_expression") site = exitCodeAssignment(node);
    if (site) sites.push(site);
  }
  return sites;
}

function isStaticMethod(fn: Node): boolean {
  const decorated = fn.parent?.type === "decorated_definition" ? fn.parent : undefined;
  return named(decorated).some((d) => d.type === "decorator" && d.text === "@staticmethod");
}

function hasReceiver(fn: Node): boolean {
  const holder = fn.parent?.type === "decorated_definition" ? fn.parent : fn;
  const block = holder.parent;
  return block?.type === "block" && block.parent?.type === "class_definition" && !isStaticMethod(fn);
}

function pythonParam(param: Node, positional: boolean): Param | undefined {
  if (param.type === "identifier") return { name: param.text, positional, required: true };
  if (param.type === "typed_parameter") {
    const first = param.namedChildren[0];
    return first?.type === "identifier" ? { name: first.text, positional, required: true } : undefined;
  }
  if (param.type !== "default_parameter" && param.type !== "typed_default_parameter") return undefined;
  const name = param.childForFieldName("name")?.text;
  const value = param.childForFieldName("value")?.text;
  return name === undefined ? undefined : { name, positional, required: false, ...(value === undefined ? {} : { default: collapse(value) }) };
}

const STARTS_KEYWORD_ONLY = (param: Node): boolean =>
  param.type === "keyword_separator" || param.type === "list_splat_pattern" || param.namedChildren[0]?.type === "list_splat_pattern";

function pythonParams(fn: Node): Param[] {
  const params: Param[] = [];
  let positional = true;
  for (const param of named(fn.childForFieldName("parameters"))) {
    if (STARTS_KEYWORD_ONLY(param)) positional = false;
    const parsed = pythonParam(param, positional);
    if (parsed) params.push(parsed);
  }
  return hasReceiver(fn) && params.length > 0 ? params.slice(1) : params;
}

function tsParam(param: Node, index: number): Param | undefined | null {
  const pattern = param.childForFieldName("pattern");
  if (!pattern || pattern.type === "this") return undefined;
  if (pattern.type === "rest_pattern") return null;
  const name = pattern.type === "identifier" ? pattern.text : `$${index}`;
  const value = param.childForFieldName("value")?.text;
  const required = param.type === "required_parameter" && value === undefined;
  return { name, positional: true, required, ...(value === undefined ? {} : { default: collapse(value) }) };
}

function tsParams(fn: Node): Param[] {
  const single = fn.childForFieldName("parameter");
  if (single) return [{ name: single.text, positional: true, required: true }];
  const params: Param[] = [];
  for (const param of named(fn.childForFieldName("parameters"))) {
    if (param.type !== "required_parameter" && param.type !== "optional_parameter") continue;
    const parsed = tsParam(param, params.length);
    if (parsed === null) break;
    if (parsed) params.push(parsed);
  }
  return params;
}

/** Lines a callable may be reported at: its own, or the first decorator above it. */
function startLines(fn: Node): number[] {
  const lines = [lineOf(fn)];
  if (fn.parent?.type === "decorated_definition") lines.push(lineOf(fn.parent));
  for (let prev = fn.previousNamedSibling; prev?.type === "decorator"; prev = prev.previousNamedSibling) lines.push(lineOf(prev));
  return lines;
}

/** Parameters of the outermost callable starting on `startLine` (or its decorators), receiver, rest and `this` dropped. */
export function paramsAt(file: ParsedFile, startLine: number): Param[] | undefined {
  const functions = functionTypes(file);
  for (const node of walk(file.tree.rootNode)) {
    if (!functions.has(node.type) || !startLines(node).includes(startLine)) continue;
    return isPython(file) ? pythonParams(node) : tsParams(node);
  }
  return undefined;
}
