import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@code-style/graph";
import {
  runGraphReportCommand,
  formatGraphReportJson,
  formatGraphReportMarkdown,
} from "../commands/graph-report.js";

interface Fixture {
  dir: string;
  dbPath: string;
}

async function fixture(
  populate: (db: GraphDatabase, snapshotId: number) => void,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-report-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
  populate(db, snapshotId);
  db.close();
  return { dir, dbPath };
}

function fileNode(id: string) {
  return { id, kind: "file" as const, name: id };
}

describe("runGraphReportCommand", () => {
  let fx: Fixture;

  afterEach(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  it("ranks hotspots by churn × complexity (prefers cognitive over cyclomatic)", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        fileNode("a.ts"),
        fileNode("b.ts"),
        fileNode("c.ts"),
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "churn_30d", value: 100 },
        { nodeId: "a.ts", name: "cyclomatic_max", value: 5 },
        { nodeId: "a.ts", name: "cognitive_max", value: 30 }, // 100*30=3000
        { nodeId: "b.ts", name: "churn_30d", value: 50 },
        { nodeId: "b.ts", name: "cognitive_max", value: 80 }, // 50*80=4000
        { nodeId: "c.ts", name: "churn_30d", value: 200 },
        { nodeId: "c.ts", name: "cognitive_max", value: 10 }, // 200*10=2000
      ]);
    });
    const result = runGraphReportCommand({
      db: fx.dbPath,
      repoRoot: fx.dir, // no git here — coupling section will be empty
      limit: 3,
    });
    expect(result.hotspots.map((h) => h.nodeId)).toEqual([
      "b.ts",
      "a.ts",
      "c.ts",
    ]);
    expect(result.hotspots[0]!.score).toBe(4000);
  });

  it("falls back to cyclomatic_max when cognitive_max isn't present", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("a.ts"));
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "churn_30d", value: 10 },
        { nodeId: "a.ts", name: "cyclomatic_max", value: 4 },
      ]);
    });
    const result = runGraphReportCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
    });
    expect(result.hotspots[0]!.score).toBe(40);
  });

  it("surfaces bus_factor=1 risks, ordered by churn desc", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [fileNode("a.ts"), fileNode("b.ts"), fileNode("c.ts")]);
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "bus_factor_30d", value: 1 },
        { nodeId: "a.ts", name: "top_author_share_30d", value: 1 },
        { nodeId: "a.ts", name: "churn_30d", value: 50 },
        { nodeId: "b.ts", name: "bus_factor_30d", value: 1 },
        { nodeId: "b.ts", name: "top_author_share_30d", value: 1 },
        { nodeId: "b.ts", name: "churn_30d", value: 200 },
        { nodeId: "c.ts", name: "bus_factor_30d", value: 2 }, // not a risk
        { nodeId: "c.ts", name: "churn_30d", value: 500 },
      ]);
    });
    const result = runGraphReportCommand({ db: fx.dbPath, repoRoot: fx.dir });
    expect(result.busFactorRisks.map((r) => r.nodeId)).toEqual(["b.ts", "a.ts"]);
  });

  it("excludes test/fixture files when --exclude-role given", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/a.ts", kind: "file", name: "a", role: "source" },
        { id: "src/a.test.ts", kind: "file", name: "test", role: "test" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/a.ts", name: "churn_30d", value: 100 },
        { nodeId: "src/a.ts", name: "cognitive_max", value: 5 },
        { nodeId: "src/a.test.ts", name: "churn_30d", value: 200 },
        { nodeId: "src/a.test.ts", name: "cognitive_max", value: 30 },
      ]);
    });
    const result = runGraphReportCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      excludeRole: ["test"],
    });
    expect(result.hotspots.map((h) => h.nodeId)).toEqual(["src/a.ts"]);
  });

  it("excludes script-role files by default, keeps them with --include-scripts", async () => {
    const populate = (db: GraphDatabase, snapshotId: number) => {
      db.insertNodes(snapshotId, [
        { id: "src/a.ts", kind: "file", name: "a", role: "source" },
        { id: "scripts/oneoff.ts", kind: "file", name: "oneoff", role: "script" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/a.ts", name: "churn_30d", value: 10 },
        { nodeId: "src/a.ts", name: "cognitive_max", value: 5 },
        { nodeId: "scripts/oneoff.ts", name: "churn_30d", value: 100 },
        { nodeId: "scripts/oneoff.ts", name: "cognitive_max", value: 219 },
      ]);
    };
    fx = await fixture(populate);
    const defaultRun = runGraphReportCommand({ db: fx.dbPath, repoRoot: fx.dir });
    expect(defaultRun.hotspots.map((h) => h.nodeId)).toEqual(["src/a.ts"]);

    const withScripts = runGraphReportCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      includeScripts: true,
    });
    expect(withScripts.hotspots.map((h) => h.nodeId)).toEqual([
      "scripts/oneoff.ts",
      "src/a.ts",
    ]);
  });

  it("flags an empty churn window with a hint (markdown + JSON)", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("a.ts"));
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "cognitive_max", value: 40 }, // no churn signal
      ]);
    });
    const result = runGraphReportCommand({ db: fx.dbPath, repoRoot: fx.dir });
    expect(result.emptyWindow).toBe(true);
    const md = formatGraphReportMarkdown(result);
    expect(md).toContain("> ⚠️ No commits in the last 30d");
    expect(md).toContain("--window-days 90");
    const parsed = JSON.parse(formatGraphReportJson(result));
    expect(parsed.emptyWindow).toBe(true);
    expect(typeof parsed.hint).toBe("string");
  });

  it("omits the empty-window hint when there is churn signal", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("a.ts"));
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "churn_30d", value: 12 },
        { nodeId: "a.ts", name: "cognitive_max", value: 4 },
      ]);
    });
    const result = runGraphReportCommand({ db: fx.dbPath, repoRoot: fx.dir });
    expect(result.emptyWindow).toBeUndefined();
    expect(formatGraphReportMarkdown(result)).not.toContain("No commits in the last");
  });

  it("falls back to a single available churn window when requested doesn't match", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("a.ts"));
      db.insertMetrics(snapshotId, [
        { nodeId: "a.ts", name: "churn_90d", value: 100 },
        { nodeId: "a.ts", name: "cognitive_max", value: 4 },
      ]);
    });
    const result = runGraphReportCommand({
      db: fx.dbPath,
      repoRoot: fx.dir,
      windowDays: 30, // snapshot only has 90d
    });
    expect(result.windowDays).toBe(90);
    expect(result.hotspots[0]?.score).toBe(400);
  });

  it("emits markdown with all four sections", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("a.ts"));
    });
    const result = runGraphReportCommand({ db: fx.dbPath, repoRoot: fx.dir });
    const md = formatGraphReportMarkdown(result);
    expect(md).toContain("# Codebase health report");
    expect(md).toContain("## Hotspots");
    expect(md).toContain("## Knowledge-silo risks");
    expect(md).toContain("## Tight coupling clusters");
    expect(md).toContain("## Most central files");
  });

  it("emits structured JSON", async () => {
    fx = await fixture((db, snapshotId) => {
      db.insertNode(snapshotId, fileNode("a.ts"));
    });
    const result = runGraphReportCommand({ db: fx.dbPath, repoRoot: fx.dir });
    const parsed = JSON.parse(formatGraphReportJson(result));
    expect(parsed.snapshot.ref).toBe("main");
    expect(parsed.windowDays).toBe(30);
    expect(Array.isArray(parsed.hotspots)).toBe(true);
  });
});
