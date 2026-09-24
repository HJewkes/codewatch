import { saveFindings, type Finding } from "@titan-design/code-graph";
import { openGraphStore } from "../utils/graph-store.js";
import { keyWithExcerpts } from "./triage-keys.js";
import { snapshotSource } from "./triage-source.js";

/** Stores the audit's findings against its snapshot, keyed and hashed the way triage will ask about them. */
export function persistFindings(dbPath: string, snapshotId: number, root: string, findings: readonly Finding[]): void {
  const store = openGraphStore(dbPath);
  try {
    // A finding outside the indexed files has no pinned text; it is stored without an excerpt hash, so no warning.
    const source = snapshotSource(store, snapshotId, root, []);
    saveFindings(store, snapshotId, keyWithExcerpts(findings, source));
  } finally {
    store.close();
  }
}
