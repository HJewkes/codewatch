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
