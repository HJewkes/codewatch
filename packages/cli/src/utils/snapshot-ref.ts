import type { CodeGraphStore, SnapshotRow } from "@titan-design/code-graph";

export interface SnapshotRefOptions {
  /** The flag named in error messages, e.g. `--from` or `--vs`. */
  flag: string;
  /** Anchors `previous`: the newest snapshot taken before this one. */
  currentId?: number;
}

/**
 * Resolve a snapshot spec: `previous`, a numeric id, or a ref name (that ref's newest
 * snapshot). For the newest snapshot, `previous` matches `graph check --baseline previous`.
 */
export function resolveSnapshotRef(
  db: CodeGraphStore,
  spec: string,
  options: SnapshotRefOptions,
): SnapshotRow {
  const { flag, currentId } = options;
  if (spec === "previous") {
    const previous = snapshotBefore(db, currentId);
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

// listSnapshots orders newest first (taken_at, then id), so the anchor's successor in the list is the one before it.
function snapshotBefore(db: CodeGraphStore, currentId: number | undefined): SnapshotRow | undefined {
  const all = db.listSnapshots({ limit: 1_000_000 });
  if (currentId === undefined) return all[0];
  const anchor = all.findIndex((s) => s.id === currentId);
  return anchor === -1 ? undefined : all[anchor + 1];
}
