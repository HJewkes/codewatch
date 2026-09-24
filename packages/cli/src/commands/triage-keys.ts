import { keyFindings, type Finding, type FindingKeyInput, type StoredFinding } from "@titan-design/code-graph";
import { symbolOf, type SymbolSpan } from "./audit-score.js";
import { findingExcerptHash, flaggedLines } from "./triage-bundle.js";
import type { BundleSource } from "./triage-source.js";

/** File text and symbol spans, enough to key a finding. */
export interface KeySource {
  lines(path: string): readonly string[] | undefined;
  symbols(path: string): readonly SymbolSpan[];
}

function flaggedText(f: Finding, text: readonly string[]): string {
  return flaggedLines(f)
    .map((n) => text[n - 1] ?? "")
    .join("\n");
}

export function keyInputOf(f: Finding, source: KeySource, excerptHash?: string): FindingKeyInput {
  const anchor = symbolOf(f, source.symbols(f.path)) ?? f.path;
  const input: FindingKeyInput = { finding: f, anchor, flaggedText: flaggedText(f, source.lines(f.path) ?? []) };
  return excerptHash === undefined ? input : { ...input, excerptHash };
}

/** Keys findings the way the audit stores them, each with its own excerpt hash when its file is pinned. */
export function keyWithExcerpts(findings: readonly Finding[], source: BundleSource, cap?: number): StoredFinding[] {
  return keyFindings(findings.map((f) => keyInputOf(f, source, findingExcerptHash(f, source, cap))));
}
