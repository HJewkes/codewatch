import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@codewatch/graph";
import {
  runGraphCheckCommand,
  formatGraphCheckText,
  formatGraphCheckJson,
  selectRefSnapshot,
} from "../commands/graph-check.js";
import type { SnapshotRow } from "@codewatch/graph";

interface Fixture {
  dir: string;
  dbPath: string;
  configPath: string;
  snapshotId: number;
}

async function createFixture(
  populate: (db: GraphDatabase, snapshotId: number) => void,
  config: object,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-check-cli-"));
  const dbPath = path.join(dir, "graph.db");
  const configPath = path.join(dir, "check.json");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.1.0" });
  populate(db, snapshotId);
  db.close();
  await fs.writeFile(configPath, JSON.stringify(config), "utf8");
  return { dir, dbPath, configPath, snapshotId };
}

describe("runGraphCheckCommand", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("returns passed=true when nothing violates", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "f.ts", name: "loc", value: 10 });
      },
      { rules: [{ id: "r", type: "metric-max", metric: "loc", max: 100 }] },
    );

    const result = await runGraphCheckCommand({
      db: fixture.dbPath,
      config: fixture.configPath,
    });
    expect(result.result.passed).toBe(true);
    expect(result.result.violations).toEqual([]);
  });

  it("returns passed=false with violations when threshold breached", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "huge.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "huge.ts", name: "loc", value: 9999 });
      },
      { rules: [{ id: "max-loc", type: "metric-max", metric: "loc", max: 500 }] },
    );

    const result = await runGraphCheckCommand({
      db: fixture.dbPath,
      config: fixture.configPath,
    });
    expect(result.result.passed).toBe(false);
    expect(result.result.violations[0]!.nodeId).toBe("huge.ts");
    expect(result.result.violations[0]!.threshold).toBe(500);
  });

  it("throws on missing config file", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "f", kind: "file", name: "" });
      },
      { rules: [] },
    );

    await expect(
      runGraphCheckCommand({
        db: fixture.dbPath,
        config: path.join(fixture.dir, "missing.json"),
      }),
    ).rejects.toThrow(/Cannot read rules file/);
  });

  it("throws on invalid JSON", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "f", kind: "file", name: "" });
      },
      { rules: [] },
    );
    await fs.writeFile(fixture.configPath, "{ this is not json", "utf8");

    await expect(
      runGraphCheckCommand({
        db: fixture.dbPath,
        config: fixture.configPath,
      }),
    ).rejects.toThrow(/Invalid JSON/);
  });

  it("renders a human-readable text summary on pass", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "ok.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "ok.ts", name: "loc", value: 1 });
      },
      { rules: [{ id: "r", type: "metric-max", metric: "loc", max: 100 }] },
    );

    const result = await runGraphCheckCommand({
      db: fixture.dbPath,
      config: fixture.configPath,
    });
    const text = formatGraphCheckText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("Graph check");
    expect(text).toContain("rule(s) passed");
  });

  it("groups violations by rule id in text output", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNodes(snapshotId, [
          { id: "a.ts", kind: "file", name: "" },
          { id: "b.ts", kind: "file", name: "" },
        ]);
        db.insertMetrics(snapshotId, [
          { nodeId: "a.ts", name: "loc", value: 1000 },
          { nodeId: "b.ts", name: "loc", value: 1000 },
        ]);
      },
      { rules: [{ id: "max-loc", type: "metric-max", metric: "loc", max: 100 }] },
    );

    const result = await runGraphCheckCommand({
      db: fixture.dbPath,
      config: fixture.configPath,
    });
    const text = formatGraphCheckText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("max-loc (2)");
    expect(text).toContain("a.ts");
    expect(text).toContain("b.ts");
    expect(text).toContain("error(s)");
  });

  it("resolves --baseline by ref and marks shared violations as carryover", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-baseline-cli-"));
    const dbPath = path.join(dir, "graph.db");
    const configPath = path.join(dir, "check.json");
    const db = openDatabase(dbPath);
    const baselineId = db.createSnapshot({ ref: "base", indexVersion: "0.1.0" });
    db.insertNode(baselineId, { id: "huge.ts", kind: "file", name: "" });
    db.insertMetric(baselineId, { nodeId: "huge.ts", name: "loc", value: 9000 });
    const headId = db.createSnapshot({ ref: "head", indexVersion: "0.1.0" });
    db.insertNodes(headId, [
      { id: "huge.ts", kind: "file", name: "" },
      { id: "new.ts", kind: "file", name: "" },
    ]);
    db.insertMetrics(headId, [
      { nodeId: "huge.ts", name: "loc", value: 9001 },
      { nodeId: "new.ts", name: "loc", value: 1234 },
    ]);
    db.close();
    await fs.writeFile(
      configPath,
      JSON.stringify({
        rules: [{ id: "max-loc", type: "metric-max", metric: "loc", max: 500 }],
      }),
      "utf8",
    );
    fixture = { dir, dbPath, configPath, snapshotId: headId };

    const result = await runGraphCheckCommand({
      db: dbPath,
      config: configPath,
      snapshot: headId,
      baseline: "base",
    });
    expect(result.baselineSnapshot?.id).toBe(baselineId);
    expect(result.result.newErrors).toBe(1);
    expect(result.result.carryoverErrors).toBe(1);
    const text = formatGraphCheckText(result).replace(/\[[0-9;]*m/g, "");
    expect(text).toContain("vs baseline");
    expect(text).toContain("1 new, 1 carryover");
  });

  it("--snapshot resolves a ref name, checking the head-vs-baseline pair regardless of index order (C-45)", async () => {
    // Mirror CI: head is indexed FIRST, then baseline — so baseline is the
    // LATEST snapshot in the shared DB.
    const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-snapref-cli-"));
    const dbPath = path.join(dir, "graph.db");
    const configPath = path.join(dir, "check.json");
    const db = openDatabase(dbPath);
    const headId = db.createSnapshot({ ref: "head", indexVersion: "0.1.0" });
    db.insertNode(headId, { id: "new.ts", kind: "file", name: "" });
    db.insertMetric(headId, { nodeId: "new.ts", name: "loc", value: 9001 });
    const baselineId = db.createSnapshot({
      ref: "baseline",
      indexVersion: "0.1.0",
    });
    db.insertNode(baselineId, { id: "ok.ts", kind: "file", name: "" });
    db.insertMetric(baselineId, { nodeId: "ok.ts", name: "loc", value: 1 });
    db.close();
    await fs.writeFile(
      configPath,
      JSON.stringify({
        rules: [{ id: "max-loc", type: "metric-max", metric: "loc", max: 500 }],
      }),
      "utf8",
    );
    fixture = { dir, dbPath, configPath, snapshotId: headId };

    // Without --snapshot the default (latest) is the baseline, so the check
    // compares baseline-vs-baseline and misses head's new violation — the no-op
    // gate this fix repairs.
    const noop = await runGraphCheckCommand({
      db: dbPath,
      config: configPath,
      baseline: "baseline",
    });
    expect(noop.snapshot.id).toBe(baselineId);
    expect(noop.result.newErrors).toBe(0);

    // --snapshot head pins the head snapshot by ref, catching the regression.
    const meaningful = await runGraphCheckCommand({
      db: dbPath,
      config: configPath,
      snapshot: "head",
      baseline: "baseline",
    });
    expect(meaningful.snapshot.id).toBe(headId);
    expect(meaningful.baselineSnapshot?.id).toBe(baselineId);
    expect(meaningful.result.newErrors).toBe(1);
    expect(meaningful.result.passed).toBe(false);
  });

  it("--baseline previous picks the second-to-latest snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-prev-cli-"));
    const dbPath = path.join(dir, "graph.db");
    const configPath = path.join(dir, "check.json");
    const db = openDatabase(dbPath);
    const olderId = db.createSnapshot({ ref: "old", indexVersion: "0.1.0" });
    db.insertNode(olderId, { id: "f.ts", kind: "file", name: "" });
    db.insertMetric(olderId, { nodeId: "f.ts", name: "loc", value: 9000 });
    const newerId = db.createSnapshot({ ref: "new", indexVersion: "0.1.0" });
    db.insertNode(newerId, { id: "f.ts", kind: "file", name: "" });
    db.insertMetric(newerId, { nodeId: "f.ts", name: "loc", value: 9000 });
    db.close();
    await fs.writeFile(
      configPath,
      JSON.stringify({
        rules: [{ id: "r", type: "metric-max", metric: "loc", max: 100 }],
      }),
      "utf8",
    );
    fixture = { dir, dbPath, configPath, snapshotId: newerId };

    const result = await runGraphCheckCommand({
      db: dbPath,
      config: configPath,
      baseline: "previous",
    });
    expect(result.baselineSnapshot?.id).toBe(olderId);
    expect(result.result.carryoverErrors).toBe(1);
    expect(result.result.newErrors).toBe(0);
    expect(result.result.passed).toBe(true);
  });

  it("--baseline previous errors on the very first run with no prior snapshot", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      },
      { rules: [] },
    );
    await expect(
      runGraphCheckCommand({
        db: fixture.dbPath,
        config: fixture.configPath,
        baseline: "previous",
      }),
    ).rejects.toThrow(/first run/);
  });

  it("throws a helpful error when --baseline ref is unknown", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      },
      { rules: [] },
    );
    await expect(
      runGraphCheckCommand({
        db: fixture.dbPath,
        config: fixture.configPath,
        baseline: "no-such-ref",
      }),
    ).rejects.toThrow(/no snapshot found for ref "no-such-ref"/);
  });

  it("emits structured JSON when requested", async () => {
    fixture = await createFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "f.ts", name: "loc", value: 200 });
      },
      { rules: [{ id: "r", type: "metric-max", metric: "loc", max: 100 }] },
    );

    const result = await runGraphCheckCommand({
      db: fixture.dbPath,
      config: fixture.configPath,
    });
    const json = JSON.parse(formatGraphCheckJson(result));
    expect(json.result.passed).toBe(false);
    expect(json.result.violations).toHaveLength(1);
  });
});

describe("selectRefSnapshot (C-69 stale-baseline guard)", () => {
  function snap(id: number, commitHash: string | null): SnapshotRow {
    return {
      id,
      ref: "main",
      commitHash,
      takenAt: "",
      indexVersion: "0.1.0",
      attrs: {},
    };
  }

  it("picks the snapshot indexed at the ref's current commit, stale=false", () => {
    const snapshots = [snap(3, "ccccccc"), snap(2, "bbbbbbb"), snap(1, "aaaaaaa")];
    const { snapshot, stale } = selectRefSnapshot(snapshots, "aaaaaaa");
    expect(snapshot.id).toBe(1);
    expect(stale).toBe(false);
  });

  it("falls back to the newest and flags stale when no snapshot matches HEAD", () => {
    const snapshots = [snap(3, "ccccccc"), snap(1, "aaaaaaa")];
    const { snapshot, stale } = selectRefSnapshot(snapshots, "ddddddd");
    expect(snapshot.id).toBe(3);
    expect(stale).toBe(true);
  });

  it("skips the staleness check when the newest snapshot has a null commitHash", () => {
    const snapshots = [snap(3, null), snap(1, "aaaaaaa")];
    const { snapshot, stale } = selectRefSnapshot(snapshots, "ddddddd");
    expect(snapshot.id).toBe(3);
    expect(stale).toBe(false);
  });

  it("skips the staleness check when git cannot resolve the ref (null commit)", () => {
    const snapshots = [snap(3, "ccccccc"), snap(1, "aaaaaaa")];
    const { snapshot, stale } = selectRefSnapshot(snapshots, null);
    expect(snapshot.id).toBe(3);
    expect(stale).toBe(false);
  });
});
