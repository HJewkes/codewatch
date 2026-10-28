import type { Finding } from "@titan-design/code-graph";
import { parseFile, type ParsedFile } from "@titan-design/code-parser";
import { touches, type ChangedLines } from "./audit-changed.js";
import { isTestPath } from "./audit-contract.js";
import { findInvokers, type Invoker } from "./audit-invokers.js";
import { contractOf, guardLineOf } from "./audit-script-facts.js";

export interface ScriptContractInput {
  changed: ChangedLines;
  readBase: (file: string) => string | undefined;
  readHead: (file: string) => string | undefined;
  /** Repo-relative tracked files at head, the invoker search space. */
  files: () => readonly string[];
}

interface ScriptChange {
  kind: string;
  detail: string;
  change: string;
  affects: (invoker: Invoker) => boolean;
}

const SCRIPT_FILE = /\.(?:py|ts|mts|mjs|cjs|js)$/;
const LISTED = 5;

const parse = (text: string, file: string): Promise<ParsedFile> => parseFile(text, file, file.endsWith(".py") ? "python" : "typescript");
const codeSet = (codes: readonly number[]): string => `{${codes.join(",")}}`;

function codeChanges(before: readonly number[], after: readonly number[]): ScriptChange[] {
  const change = (verb: string, code: number): string => `exit codes ${codeSet(before)} -> ${codeSet(after)} (${verb} ${code})`;
  const every = (): boolean => true;
  return [
    ...after.filter((c) => !before.includes(c)).map((c) => ({ kind: "exit-code-added", detail: String(c), change: change("added", c), affects: every })),
    ...before.filter((c) => !after.includes(c)).map((c) => ({ kind: "exit-code-removed", detail: String(c), change: change("removed", c), affects: every })),
  ];
}

function flagChanges(before: readonly string[], after: readonly string[]): ScriptChange[] {
  return before
    .filter((flag) => !after.includes(flag))
    .map((flag) => ({ kind: "flag-removed", detail: flag, change: `flag ${flag} no longer accepted`, affects: (i: Invoker) => i.args.includes(flag) }));
}

function cite(invokers: readonly Invoker[]): string {
  if (invokers.length === 0) return "none";
  const cited = invokers
    .map((i) => `${i.file}:${i.line}${i.label ? ` ${i.label}` : ""}${i.via ? ` via ${i.via}` : ""}`)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const more = cited.length > LISTED ? ` (+${cited.length - LISTED} more)` : "";
  return `${cited.slice(0, LISTED).join(", ")}${more}`;
}

function changeFinding(script: string, guardLine: number, change: ScriptChange, invokers: readonly Invoker[], changed: ChangedLines): Finding | undefined {
  const affected = invokers.filter(change.affects);
  const inDiff = (i: Invoker): boolean => touches(changed, i.file, { start: i.line, end: i.line });
  const callers = affected.filter((i) => !isTestPath(i.file));
  const testsOut = affected.filter((i) => isTestPath(i.file) && !inDiff(i));
  const callersOut = callers.filter((i) => !inDiff(i));
  if (callersOut.length + testsOut.length === 0) return undefined;
  return {
    id: `codewatch:contract-change:${script}:${change.kind}:${change.detail}`,
    path: script,
    lineStart: guardLine,
    signal: "contract-change",
    severity: "warning",
    evidence: [`change: ${change.change}`, `invokers not in diff: ${cite(callersOut)}`, `invokers in diff: ${cite(callers.filter(inDiff))}`, `tests not in diff: ${cite(testsOut)}`].join("\n"),
    tool: "codewatch",
  };
}

async function scriptFindings(script: string, input: ScriptContractInput): Promise<Finding[]> {
  const [baseText, headText] = [input.readBase(script), input.readHead(script)];
  if (baseText === undefined || headText === undefined) return [];
  const [base, head] = [await parse(baseText, script), await parse(headText, script)];
  const guardLine = guardLineOf(head) ?? guardLineOf(base);
  if (guardLine === undefined) return [];
  const [before, after] = [contractOf(base), contractOf(head)];
  const changes = [...codeChanges(before.exitCodes, after.exitCodes), ...flagChanges(before.flags, after.flags)];
  if (changes.length === 0) return [];
  const invokers = findInvokers({ script, files: input.files(), readFile: input.readHead });
  return changes.flatMap((change) => changeFinding(script, guardLine, change, invokers, input.changed) ?? []);
}

/**
 * `contract-change` findings at the process boundary: a changed script (one with an entry guard)
 * whose exit codes or accepted flags changed while some affected invoker sits outside the diff.
 */
export async function scriptContractFindings(input: ScriptContractInput): Promise<Finding[]> {
  const scripts = [...input.changed.keys()].filter((f) => SCRIPT_FILE.test(f));
  const out: Finding[] = [];
  for (const script of scripts) out.push(...(await scriptFindings(script, input)));
  return out;
}
