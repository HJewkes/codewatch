import { z } from "zod";
import type { VerdictRecord } from "./triage-output.js";
import { CitationSchema } from "./triage-prompt.js";
import { VERDICTS } from "./triage-questions.js";

/**
 * Every field of a committed verdict row that is read or saved, typed as graph.db binds it.
 * Unlisted fields, such as another database's `carriedFrom`, are dropped by the parse.
 */
const CommittedVerdictSchema = z.object({
  key: z.string().min(1),
  verdict: z.enum(VERDICTS),
  rationale: z.string(),
  citations: z.array(CitationSchema),
  path: z.string(),
  signal: z.string(),
  tool: z.string(),
  symbol: z.string().optional(),
  excerptHash: z.string().min(1),
  model: z.string(),
  costUsd: z.number().finite(),
  runId: z.string(),
  provenance: z.enum(["model", "carried", "file"]),
  controlRun: z.enum(["ok", "provisional"]),
});

/** One line of a committed verdict file, rebuilt field by field, or undefined when graph.db could not store it. */
export function parseCommittedVerdict(line: string): VerdictRecord | undefined {
  try {
    const parsed = CommittedVerdictSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
