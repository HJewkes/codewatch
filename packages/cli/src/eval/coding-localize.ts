import type { Finding } from "@titan-design/code-graph";
import { symbolKey, symbolOf, type SymbolSpan } from "../commands/audit-score.js";
import { gradeSet } from "./grader.js";
import type { SetScore } from "./types.js";

/**
 * C-93 S2: where the agent edited against where the gold patch edited, at file, symbol and line level.
 * F1 is reported, never optimised: gold patches under-credit coupled callers, tests and neighbours.
 */

/** One file a diff touches, in parent-commit (old-side) path and line coordinates. */
export interface DiffLocation {
  file: string;
  parentLines: number[];
}

/** Symbol spans of one file in the parent-commit index; injected so scoring needs no database. */
export type SpansFor = (path: string) => readonly SymbolSpan[];

export interface LocalizationScore {
  file: SetScore;
  symbol: SetScore;
  line: SetScore;
}

const MODULE_SYMBOL = "<module>";
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

interface ParseState {
  locations: DiffLocation[];
  current?: { file: string; lines: Set<number> };
  /** The next parent-side line a context or deletion line consumes. */
  oldLine: number;
  inHunk: boolean;
}

function startFile(state: ParseState, file: string): void {
  flush(state);
  state.current = { file, lines: new Set() };
  state.inHunk = false;
}

function flush(state: ParseState): void {
  if (!state.current) return;
  const parentLines = [...state.current.lines].sort((a, b) => a - b);
  state.locations.push({ file: state.current.file, parentLines });
  state.current = undefined;
}

function startHunk(state: ParseState, header: RegExpExecArray): void {
  const start = Number(header[1]);
  state.inHunk = true;
  // A zero-length old side names the line after which the insertion lands.
  state.oldLine = header[2] === "0" ? start + 1 : start;
}

const stripPrefix = (p: string): string => p.replace(/^[ab]\//, "");

function renameFile(state: ParseState, line: string): void {
  if (state.current) state.current.file = line.slice("rename from ".length);
}

function oldSideFile(state: ParseState, line: string): void {
  const p = line.slice(4).trim();
  if (state.current && p !== "/dev/null") state.current.file = stripPrefix(p);
}

function newSideFile(state: ParseState, line: string): void {
  const p = line.slice(4).trim();
  if (state.current && p !== "/dev/null" && state.current.file === "") state.current.file = stripPrefix(p);
}

function diffHeader(state: ParseState, line: string): void {
  const match = / a\/(.+) b\//.exec(line);
  startFile(state, match?.[1] ?? "");
}

function hunkBody(state: ParseState, line: string): void {
  const lines = state.current?.lines;
  if (!lines) return;
  switch (line[0]) {
    case " ":
      state.oldLine++;
      return;
    case "-":
      lines.add(state.oldLine++);
      return;
    case "+":
      lines.add(state.oldLine - 1);
      return;
  }
}

const FILE_HEADER_HANDLERS: ReadonlyArray<[string, (state: ParseState, line: string) => void]> = [
  ["rename from ", renameFile],
  ["--- ", oldSideFile],
  ["+++ ", newSideFile],
];

function parseLine(state: ParseState, line: string): void {
  if (line.startsWith("diff --git ")) return diffHeader(state, line);
  const handler = state.inHunk ? undefined : FILE_HEADER_HANDLERS.find(([prefix]) => line.startsWith(prefix));
  if (handler) return handler[1](state, line);
  const hunk = HUNK_HEADER.exec(line);
  if (hunk) return startHunk(state, hunk);
  hunkBody(state, line);
}

/** Every file a unified git diff touches, with parent-side lines; a pure insertion keys to the parent line before it. */
export function parseDiffLocations(diff: string): DiffLocation[] {
  const state: ParseState = { locations: [], oldLine: 0, inHunk: false };
  for (const line of diff.split("\n")) parseLine(state, line);
  flush(state);
  return state.locations.filter((l) => l.file !== "");
}

function lineProbe(path: string, line: number): Finding {
  return { id: "", path, lineStart: line, signal: "edit", severity: "warning", tool: "localize" };
}

function symbolKeys(loc: DiffLocation, spansFor: SpansFor): string[] {
  const moduleKey = symbolKey(loc.file, MODULE_SYMBOL);
  if (loc.parentLines.length === 0) return [moduleKey];
  const spans = spansFor(loc.file);
  return loc.parentLines.map((line) => symbolOf(lineProbe(loc.file, line), spans) ?? moduleKey);
}

function keysOf(locations: readonly DiffLocation[], spansFor: SpansFor) {
  return {
    file: locations.map((l) => l.file),
    symbol: locations.flatMap((l) => symbolKeys(l, spansFor)),
    line: locations.flatMap((l) => l.parentLines.map((n) => `${l.file}:${n}`)),
  };
}

/** Localization-F1 of an agent diff against the gold diff; a line outside every symbol keys to `file#<module>`. */
export function scoreLocalization(goldDiff: string, agentDiff: string, spansFor: SpansFor): LocalizationScore {
  const gold = keysOf(parseDiffLocations(goldDiff), spansFor);
  const agent = keysOf(parseDiffLocations(agentDiff), spansFor);
  return {
    file: gradeSet(gold.file, agent.file),
    symbol: gradeSet(gold.symbol, agent.symbol),
    line: gradeSet(gold.line, agent.line),
  };
}
