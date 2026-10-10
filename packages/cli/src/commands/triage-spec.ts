import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { splitLines } from "@titan-design/evidence";
import { lineRange, type ShownLines } from "./triage-excerpt.js";
import type { VerdictRow } from "./triage-prompt.js";
import type { BundleSource } from "./triage-source.js";

/** The path the reader sees and cites the spec under; it names no workspace file. */
export const SPEC_PATH = "<spec>";

/** Spec lines shorter than this are too generic to strip out of a rationale. */
const MIN_REDACTED_LINE = 12;

function isWithin(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The spec must stay where neither the agent nor graph.db can read it, so a file inside the workspace is refused. */
export function readSpec(file: string, workspace: string): string[] {
  const real = realpathSync(file);
  if (isWithin(realpathSync(workspace), real)) throw new Error(`--spec ${file} is inside the workspace; pass a file outside it`);
  return splitLines(readFileSync(real, "utf8"));
}

/** A source that also serves the spec's lines under SPEC_PATH, so bundling and citation checks treat it like a file; without a spec, SPEC_PATH is never looked up in the tree. */
export function withSpec(source: BundleSource, spec: readonly string[] | undefined): BundleSource {
  return { ...source, lines: (p) => (p === SPEC_PATH ? spec : source.lines(p)) };
}

export function specShown(source: BundleSource): ShownLines | undefined {
  const spec = source.lines(SPEC_PATH);
  return spec ? new Map([[SPEC_PATH, new Set(lineRange(1, spec.length, spec.length))]]) : undefined;
}

function redactRationale(rationale: string, spec: readonly string[]): string {
  const lines = spec.map((l) => l.trim()).filter((l) => l.length >= MIN_REDACTED_LINE);
  return lines.reduce((text, line) => text.split(line).join(SPEC_PATH), rationale);
}

/** Verdicts are stored under the workspace, so a spec quote is emptied and spec lines copied into the rationale are replaced. */
export function redactSpec(row: VerdictRow, spec: readonly string[] | undefined): VerdictRow {
  if (!spec) return row;
  return {
    ...row,
    rationale: redactRationale(row.rationale, spec),
    citations: row.citations.map((c) => (c.path === SPEC_PATH ? { ...c, quote: "" } : c)),
  };
}

/** Runs `work` with a scratch directory outside the workspace, removed afterwards. */
export async function inScratchDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "codewatch-triage-"));
  try {
    return await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
