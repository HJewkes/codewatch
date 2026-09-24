import { z } from "zod";
import type { TriageItem } from "./triage-items.js";
import { renderQuestion, VERDICTS } from "./triage-questions.js";

export const MAX_RATIONALE = 300;

const CitationSchema = z.object({
  path: z.string(),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  quote: z.string(),
});

export const VerdictRowSchema = z.object({
  key: z.string(),
  verdict: z.enum(VERDICTS),
  rationale: z.string().max(MAX_RATIONALE),
  citations: z.array(CitationSchema).min(1).max(3),
});

/** One call answers every question in its bundle, so the output is a list of verdict rows. */
export const ReaderOutputSchema = z.object({ verdicts: z.array(VerdictRowSchema) });

export type VerdictRow = z.infer<typeof VerdictRowSchema>;
export type ReaderOutput = z.infer<typeof ReaderOutputSchema>;

export const READER_SYSTEM_PROMPT = [
  "You judge findings from a static analysis of source code. You have no tools; judge only the code in the prompt.",
  "Answer every question with exactly one verdict row whose key is the question's bracketed key, copied exactly.",
  "Use the verdict meanings each question gives. When the lines shown are not enough to decide, answer unclear.",
  "Cite 1 to 3 line ranges from the numbered lines shown. Quote the cited code exactly as written, without the line-number prefix.",
  `Keep each rationale under ${MAX_RATIONALE} characters. State the reason for the verdict; do not suggest changes.`,
].join("\n");

export function renderPrompt(item: TriageItem): string {
  const questions = item.questions.map((q) => renderQuestion(q.finding, q.question, q.key)).join("\n\n");
  return [
    `Questions (${item.questions.length}):`,
    "",
    questions,
    "",
    "Code (numbered lines; only these lines are shown, and a line of dots marks skipped lines):",
    "",
    item.excerpt,
  ].join("\n");
}
