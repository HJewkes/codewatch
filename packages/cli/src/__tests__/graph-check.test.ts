import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "@code-style/graph";
import {
  runGraphCheckCommand,
  formatGraphCheckText,
  formatGraphCheckJson,
} from "../commands/graph-check.js";

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
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-check-cli-"));
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
    const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-baseline-cli-"));
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

  it("--baseline previous picks the second-to-latest snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-prev-cli-"));
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
