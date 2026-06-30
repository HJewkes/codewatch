import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../database.js";
import { runGraphIndex } from "../indexer.js";

interface Project {
  rootDir: string;
  dbPath: string;
}

async function createProject(): Promise<Project> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), "code-style-metrics-"));
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "src", "a.ts"),
    "export const A = 1;\n",
  );
  await fs.writeFile(
    path.join(rootDir, "src", "b.ts"),
    'import { A } from "./a.js";\nexport const B = A + 1;\n',
  );
  await fs.writeFile(
    path.join(rootDir, "src", "c.ts"),
    'import { A } from "./a.js";\nexport const C = A * 2;\n',
  );
  return { rootDir, dbPath: path.join(rootDir, ".codewatch", "graph.db") };
}

describe("runGraphIndex with metric computation", () => {
  let project: Project;

  beforeEach(async () => {
    project = await createProject();
  });

  afterEach(async () => {
    await fs.rm(project.rootDir, { recursive: true, force: true });
  });

  it("populates the metric table with fan_in/fan_out/instability", async () => {
    const result = await runGraphIndex({ rootDir: project.rootDir });
    expect(result.metrics).toBeGreaterThan(0);

    const db = openDatabase(project.dbPath);
    try {
      const all = db.listMetrics(result.snapshotId);
      const names = new Set(all.map((m) => m.name));
      expect(names.has("fan_in")).toBe(true);
      expect(names.has("fan_out")).toBe(true);
      expect(names.has("instability")).toBe(true);

      const aFanIn = all.find(
        (m) => m.nodeId === "src/a.ts" && m.name === "fan_in",
      );
      const aFanOut = all.find(
        (m) => m.nodeId === "src/a.ts" && m.name === "fan_out",
      );
      // src/a.ts is imported by b.ts and c.ts → fan_in = 2, fan_out = 0.
      expect(aFanIn?.value).toBe(2);
      expect(aFanOut?.value).toBe(0);

      const aInstability = all.find(
        (m) => m.nodeId === "src/a.ts" && m.name === "instability",
      );
      // I = 0/(0+2) = 0 — max stable.
      expect(aInstability?.value).toBe(0);
    } finally {
      db.close();
    }
  });

  it("emits no metrics when computeMetrics=false", async () => {
    const result = await runGraphIndex({
      rootDir: project.rootDir,
      computeMetrics: false,
    });
    expect(result.metrics).toBe(0);

    const db = openDatabase(project.dbPath);
    try {
      expect(db.listMetrics(result.snapshotId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("populates metrics for module nodes too", async () => {
    const result = await runGraphIndex({ rootDir: project.rootDir });
    const db = openDatabase(project.dbPath);
    try {
      const moduleMetrics = db
        .listMetrics(result.snapshotId)
        .filter((m) => m.nodeId === "src/a");
      // Each node — file or module — gets fan_in and fan_out.
      const names = new Set(moduleMetrics.map((m) => m.name));
      expect(names.has("fan_in")).toBe(true);
      expect(names.has("fan_out")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("links a co-located test to its source (linked_test_count)", async () => {
    // A standalone project so the extra test file doesn't perturb the shared
    // fixture's fan-in/out assertions.
    const rootDir = await fs.mkdtemp(path.join(tmpdir(), "code-style-link-"));
    try {
      await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(rootDir, "src", "calc.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
      );
      await fs.writeFile(
        path.join(rootDir, "src", "calc.test.ts"),
        'import { add } from "./calc.js";\nadd(1, 2);\n',
      );
      const result = await runGraphIndex({ rootDir });
      const db = openDatabase(path.join(rootDir, ".codewatch", "graph.db"));
      try {
        const count = db
          .listMetrics(result.snapshotId)
          .find(
            (m) => m.nodeId === "src/calc.ts" && m.name === "linked_test_count",
          );
        expect(count?.value).toBe(1);
        // The metric is keyed on the source, never the test file itself.
        const onTest = db
          .listMetrics(result.snapshotId)
          .some(
            (m) =>
              m.nodeId === "src/calc.test.ts" &&
              m.name === "linked_test_count",
          );
        expect(onTest).toBe(false);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("populates source-content metrics on file nodes", async () => {
    const result = await runGraphIndex({ rootDir: project.rootDir });
    const db = openDatabase(project.dbPath);
    try {
      const fileMetrics = db
        .listMetrics(result.snapshotId)
        .filter((m) => m.nodeId === "src/b.ts");
      const names = new Set(fileMetrics.map((m) => m.name));
      expect(names.has("loc")).toBe(true);
      expect(names.has("function_count")).toBe(true);
      // Module nodes don't get source metrics — only file nodes.
      const moduleMetricNames = new Set(
        db
          .listMetrics(result.snapshotId)
          .filter((m) => m.nodeId === "src/b")
          .map((m) => m.name),
      );
      expect(moduleMetricNames.has("loc")).toBe(false);
    } finally {
      db.close();
    }
  });
});
