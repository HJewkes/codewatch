import { openDatabase } from "@codewatch/graph";

/**
 * The churn windows the latest snapshot actually stored — its finite day-counts
 * (from `churn_<n>d` metric names) and whether an all-time `lifetime` window is
 * present (C-71). Split out of dashboard-payload.ts (over the max-file-loc
 * budget) so the payload builder offers exactly the stored windows in its
 * switcher instead of probing — and warning about — windows it never computed.
 */
export function storedChurnWindows(dbPath: string): {
  finite: Set<number>;
  lifetime: boolean;
} {
  const db = openDatabase(dbPath);
  try {
    const snap = db.listSnapshots({ limit: 1 })[0];
    const finite = new Set<number>();
    let lifetime = false;
    if (snap) {
      for (const m of db.listMetrics(snap.id)) {
        if (m.name === "churn_lifetime") lifetime = true;
        const match = /^churn_(\d+)d$/.exec(m.name);
        if (match) finite.add(Number(match[1]));
      }
    }
    return { finite, lifetime };
  } catch {
    return { finite: new Set(), lifetime: false };
  } finally {
    db.close();
  }
}
