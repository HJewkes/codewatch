import { openDatabase } from "@code-style/graph";
import type { RenderInput } from "./types.js";

export async function loadSnapshot(
  dbPath: string,
  snapshotId?: number,
): Promise<RenderInput> {
  const db = openDatabase(dbPath);
  try {
    const id = snapshotId ?? pickLatestSnapshotId(db);
    if (id === null) {
      throw new Error(`No snapshots found in ${dbPath}`);
    }
    return {
      snapshotId: id,
      nodes: db.listNodes(id),
      edges: db.listEdges(id),
      metrics: db.listMetrics(id),
    };
  } finally {
    db.close();
  }
}

function pickLatestSnapshotId(
  db: ReturnType<typeof openDatabase>,
): number | null {
  const snapshots = db.listSnapshots({ limit: 1 });
  return snapshots[0]?.id ?? null;
}
