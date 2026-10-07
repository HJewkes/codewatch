import type { CodeGraphStore, SnapshotRow } from "@titan-design/code-graph";

export interface SnapshotRefOptions {
  /** The flag named in error messages, e.g. `--from` or `--vs`. */
  flag: string;
  /** Enables `previous`: the newest snapshot other than this one. */
  currentId?: number;
}

/**
 * Resolve a snapshot spec: `previous`, a numeric id, or a ref name (that ref's newest
 * snapshot). `previous` matches `graph check --baseline previous`.
 */
export function resolveSnapshotRef(
  db: CodeGraphStore,
  spec: string,
  options: SnapshotRefOptions,
): SnapshotRow {
  const { flag, currentId } = options;
  if (spec === "previous") {
    const previous = db.listSnapshots({ limit: 5 }).find((s) => s.id !== currentId);
    if (!previous) {
      throw new Error(
        `${flag}: "previous" requires at least one prior snapshot — this is the first run.`,
      );
    }
    return previous;
  }
  if (/^\d+$/.test(spec)) {
    const byId = db.getSnapshot(Number(spec));
    if (!byId) throw new Error(`${flag}: no snapshot with id ${spec}`);
    return byId;
  }
  const byRef = db.getLatestSnapshotByRef(spec);
  if (!byRef) {
    throw new Error(
      `${flag}: no snapshot found for ref "${spec}". ` +
        `Run \`codewatch graph index --ref ${spec} <path>\` first.`,
    );
  }
  return byRef;
}
