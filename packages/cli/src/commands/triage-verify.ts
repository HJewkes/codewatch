import { verifyCitation, type CitationRejection } from "@titan-design/evidence";
import type { ItemQuestion, TriageItem } from "./triage-items.js";
import { ReaderOutputSchema, type VerdictRow } from "./triage-prompt.js";

export type DropReason = CitationRejection | "unasked-key" | "duplicate-key" | "unparseable-output";

export interface DroppedRow {
  item: string;
  key?: string;
  reason: DropReason;
  detail: string;
}

export interface VerifiedRow {
  row: VerdictRow;
  question: ItemQuestion;
}

export interface ItemVerification {
  kept: VerifiedRow[];
  dropped: DroppedRow[];
  /** Rows the reader returned, kept or not; the call's cost is shared over them. */
  returned: number;
}

function parseOutput(output: string | undefined): VerdictRow[] | string {
  try {
    const parsed = ReaderOutputSchema.safeParse(JSON.parse(output ?? ""));
    return parsed.success ? parsed.data.verdicts : parsed.error.message;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function citationFailure(item: TriageItem, row: VerdictRow): Omit<DroppedRow, "item" | "key"> | undefined {
  const options = { allowedPaths: item.shown.keys(), shown: item.shown };
  for (const citation of row.citations) {
    const check = verifyCitation(item.lines, citation, options);
    if (!check.ok) return { reason: check.reason, detail: check.detail };
  }
  return undefined;
}

function rowFailure(item: TriageItem, row: VerdictRow, seen: Set<string>): Omit<DroppedRow, "item" | "key"> | undefined {
  if (!item.questions.some((q) => q.key === row.key)) return { reason: "unasked-key", detail: `no question has key ${row.key}` };
  if (seen.has(row.key)) return { reason: "duplicate-key", detail: `a second answer for ${row.key}` };
  return citationFailure(item, row);
}

/** Keeps a verdict only when it answers an asked question and every citation checks out against the lines shown. */
export function verifyItemOutput(item: TriageItem, output: string | undefined): ItemVerification {
  const rows = parseOutput(output);
  if (typeof rows === "string") {
    return { kept: [], dropped: [{ item: item.id, reason: "unparseable-output", detail: rows.slice(0, 200) }], returned: 0 };
  }
  const byKey = new Map(item.questions.map((q) => [q.key, q]));
  const seen = new Set<string>();
  const result: ItemVerification = { kept: [], dropped: [], returned: rows.length };
  for (const row of rows) {
    const failure = rowFailure(item, row, seen);
    if (failure) result.dropped.push({ item: item.id, key: row.key, ...failure });
    else result.kept.push({ row, question: byKey.get(row.key)! });
    seen.add(row.key);
  }
  return result;
}
