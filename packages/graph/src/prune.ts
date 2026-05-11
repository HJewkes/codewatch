import type { GraphDatabase } from "./database.js";
import type { SnapshotRow } from "./types.js";

export interface PrunePlan {
  keep: SnapshotRow[];
  remove: SnapshotRow[];
}

export interface PruneOptions {
  keep?: number;
  keepRefs?: readonly string[];
}

const CASCADE_TABLES = ["node", "edge", "metric", "id_alias", "boundary", "entry_point"] as const;

export function planPrune(
  db: GraphDatabase,
  options: PruneOptions = {},
): PrunePlan {
  const keepCount = options.keep ?? 10;
  const keepRefs = new Set(options.keepRefs ?? []);
  const all = db.listSnapshots({ limit: 1_000_000 });
  const keep: SnapshotRow[] = [];
  const remove: SnapshotRow[] = [];
  for (let i = 0; i < all.length; i++) {
    const snap = all[i]!;
    if (i < keepCount || keepRefs.has(snap.ref)) {
      keep.push(snap);
    } else {
      remove.push(snap);
    }
  }
  return { keep, remove };
}

export interface PruneResult {
  plan: PrunePlan;
  rowsBefore: Record<string, number>;
  rowsAfter: Record<string, number>;
  vacuumed: boolean;
}

export function runPrune(
  db: GraphDatabase,
  options: PruneOptions & { vacuum?: boolean } = {},
): PruneResult {
  const plan = planPrune(db, options);
  const tables = ["snapshot", ...CASCADE_TABLES];
  const rowsBefore = db.countRowsByTable(tables);
  db.deleteSnapshots(plan.remove.map((s) => s.id));
  if (options.vacuum) db.vacuum();
  const rowsAfter = db.countRowsByTable(tables);
  return { plan, rowsBefore, rowsAfter, vacuumed: !!options.vacuum };
}
