import type { RunnerResult } from "@titan-design/style-checker";
import { inlineRunner, type LegacyStepRunner, type StepRunInput } from "@titan-design/workflow";
import { PYTHON_TOOLS, type PythonRunners } from "../commands/audit-runners.js";
import type { VerdictRow } from "../commands/triage-prompt.js";

const EMPTY: RunnerResult = { diagnostics: [], exitCode: 0, failures: [], skippedRules: [] };
export const SILENT_RUNNERS: PythonRunners = Object.fromEntries(PYTHON_TOOLS.map((tool) => [tool, () => Promise.resolve(EMPTY)]));

export interface AskedQuestion {
  key: string;
  path: string;
  line: number;
}

/** Reads the questions back out of a rendered prompt: `[key] path:line...`. */
export function questionsIn(prompt: string): AskedQuestion[] {
  return [...prompt.matchAll(/^\[([^\]]+)\] ([^\s:]+):(\d+)/gm)].map((m) => ({ key: m[1]!, path: m[2]!, line: Number(m[3]) }));
}

/** The text the excerpt shows for one numbered line of one path. */
export function shownText(prompt: string, path: string, line: number): string {
  const section = prompt.split(`=== ${path}\n`)[1]!.split("\n\n")[0]!;
  const match = section.split("\n").find((l) => new RegExp(`^\\s*${line}\\| `).test(l))!;
  return match.replace(/^\s*\d+\| /, "");
}

export function row(q: AskedQuestion, prompt: string, verdict: VerdictRow["verdict"], quote = shownText(prompt, q.path, q.line)): VerdictRow {
  return { key: q.key, verdict, rationale: "fake reader", citations: [{ path: q.path, lineStart: q.line, lineEnd: q.line, quote }] };
}

/** A reader that answers each question with whatever `decide` returns for it. */
export function fakeReader(decide: (q: AskedQuestion, prompt: string) => VerdictRow[]): LegacyStepRunner {
  return inlineRunner((input: StepRunInput) => JSON.stringify({ verdicts: questionsIn(input.prompt).flatMap((q) => decide(q, input.prompt)) }));
}
