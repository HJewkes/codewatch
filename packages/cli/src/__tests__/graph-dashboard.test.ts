import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "@code-style/graph";
import { runGraphDashboardCommand } from "../commands/graph-dashboard.js";

async function fixture(): Promise<{ dir: string; dbPath: string; out: string }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-dashboard-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.2.0" });
  db.insertNodes(snapshotId, [
    { id: "src/a.ts", kind: "file", name: "a", role: "source" },
  ]);
  db.insertMetrics(snapshotId, [
    { nodeId: "src/a.ts", name: "churn_30d", value: 20 },
    { nodeId: "src/a.ts", name: "cognitive_max", value: 12 },
  ]);
  db.close();
  return { dir, dbPath, out: path.join(dir, "out.html") };
}

describe("runGraphDashboardCommand", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a self-contained HTML with the payload injected", async () => {
    const fx = await fixture();
    dir = fx.dir;
    const { out, snapshotId } = await runGraphDashboardCommand({
      db: fx.dbPath,
      config: path.join(fx.dir, "missing-check.json"), // absent → no violations, no throw
      out: fx.out,
      repoRoot: fx.dir,
      repo: "fixture",
    });
    expect(out).toBe(fx.out);
    const html = await fs.readFile(fx.out, "utf8");
    expect(html).toContain("window.__CODEWATCH__");
    expect(html).toContain("src/a.ts"); // the hotspot made it into the payload
    // Injected before </head> so the app reads it before mounting.
    expect(html.indexOf("window.__CODEWATCH__")).toBeLessThan(html.indexOf("</head>"));
    expect(snapshotId).toBeGreaterThan(0);
  });

  it("does not throw when the check config is missing (Fitness renders clear)", async () => {
    const fx = await fixture();
    dir = fx.dir;
    await expect(
      runGraphDashboardCommand({ db: fx.dbPath, config: "/nope/check.json", out: fx.out, repoRoot: fx.dir }),
    ).resolves.toBeTruthy();
  });
});
