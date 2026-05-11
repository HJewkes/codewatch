import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type GraphDatabase } from "../database.js";
import { runChecks, validateRules } from "../check.js";
import type { CheckRule } from "../types.js";

interface Fixture {
  dir: string;
  dbPath: string;
  snapshotId: number;
}

async function createFixture(
  populate: (db: GraphDatabase, snapshotId: number) => void,
): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-check-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({
    ref: "main",
    indexVersion: "0.1.0",
  });
  populate(db, snapshotId);
  db.close();
  return { dir, dbPath, snapshotId };
}

describe("runChecks — metric-max", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("reports nodes whose value exceeds the max", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "small.ts", kind: "file", name: "small" },
        { id: "big.ts", kind: "file", name: "big" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "small.ts", name: "loc", value: 10 },
        { nodeId: "big.ts", name: "loc", value: 1000 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-max",
            id: "max-loc",
            metric: "loc",
            max: 500,
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.nodeId).toBe("big.ts");
      expect(result.violations[0]!.value).toBe(1000);
      expect(result.violations[0]!.threshold).toBe(500);
    } finally {
      db.close();
    }
  });

  it("filters by kind", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "f.ts", kind: "file", name: "f" },
        { id: "m", kind: "module", name: "m" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "f.ts", name: "loc", value: 100 },
        { nodeId: "m", name: "loc", value: 999 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          { type: "metric-max", id: "r", metric: "loc", max: 50, kind: "file" },
        ],
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.nodeId).toBe("f.ts");
    } finally {
      db.close();
    }
  });

  it("respects excludeRoles", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/foo.ts", kind: "file", name: "foo", role: "source" },
        { id: "src/foo.test.ts", kind: "file", name: "foo.test", role: "test" },
        { id: "src/index.ts", kind: "file", name: "index", role: "barrel" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/foo.ts", name: "loc", value: 999 },
        { nodeId: "src/foo.test.ts", name: "loc", value: 999 },
        { nodeId: "src/index.ts", name: "loc", value: 999 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-max",
            id: "r",
            metric: "loc",
            max: 100,
            excludeRoles: ["test", "barrel"],
          },
        ],
      });
      expect(result.violations.map((v) => v.nodeId)).toEqual(["src/foo.ts"]);
    } finally {
      db.close();
    }
  });

  it("respects exclude patterns (glob and substring)", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/foo.ts", kind: "file", name: "foo" },
        { id: "src/__tests__/bar.test.ts", kind: "file", name: "bar.test" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "src/foo.ts", name: "loc", value: 999 },
        { nodeId: "src/__tests__/bar.test.ts", name: "loc", value: 999 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-max",
            id: "r",
            metric: "loc",
            max: 100,
            exclude: ["__tests__"],
          },
        ],
      });
      expect(result.violations.map((v) => v.nodeId)).toEqual(["src/foo.ts"]);
    } finally {
      db.close();
    }
  });

  it("skips nodes that don't have the metric", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "ext", kind: "external", name: "ext" });
      db.insertMetric(snapshotId, { nodeId: "ext", name: "fan_in", value: 5 });
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [{ type: "metric-max", id: "r", metric: "loc", max: 1 }],
      });
      expect(result.violations).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("warning severity does not flip passed=false", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      db.insertMetric(snapshotId, { nodeId: "f.ts", name: "loc", value: 1000 });
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-max",
            id: "r",
            metric: "loc",
            max: 100,
            severity: "warning",
          },
        ],
      });
      expect(result.violations).toHaveLength(1);
      expect(result.passed).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("runChecks — metric-min", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("reports nodes whose value falls below the min", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "a", kind: "file", name: "a" },
        { id: "b", kind: "file", name: "b" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "a", name: "fan_in", value: 0 },
        { nodeId: "b", name: "fan_in", value: 5 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [{ type: "metric-min", id: "r", metric: "fan_in", min: 1 }],
      });
      expect(result.violations.map((v) => v.nodeId)).toEqual(["a"]);
    } finally {
      db.close();
    }
  });
});

describe("runChecks — metric-product-max", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("flags nodes whose product of two metrics exceeds the max", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "calm.ts", kind: "file", name: "" },
        { id: "scary.ts", kind: "file", name: "" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "calm.ts", name: "churn_30d", value: 50 },
        { nodeId: "calm.ts", name: "cyclomatic_max", value: 5 },
        { nodeId: "scary.ts", name: "churn_30d", value: 200 },
        { nodeId: "scary.ts", name: "cyclomatic_max", value: 25 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-product-max",
            id: "scary-hotspots",
            metrics: ["churn_30d", "cyclomatic_max"],
            max: 1000,
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      const v = result.violations[0]!;
      expect(v.nodeId).toBe("scary.ts");
      expect(v.value).toBe(5000);
      expect(v.threshold).toBe(1000);
      expect(v.metric).toBe("churn_30d * cyclomatic_max");
      expect(v.message).toContain("churn_30d=200");
      expect(v.message).toContain("cyclomatic_max=25");
    } finally {
      db.close();
    }
  });

  it("skips nodes that are missing any of the named metrics", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "partial.ts", kind: "file", name: "" },
        { id: "complete.ts", kind: "file", name: "" },
      ]);
      db.insertMetrics(snapshotId, [
        { nodeId: "partial.ts", name: "churn_30d", value: 9999 },
        { nodeId: "complete.ts", name: "churn_30d", value: 100 },
        { nodeId: "complete.ts", name: "cyclomatic_max", value: 100 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-product-max",
            id: "r",
            metrics: ["churn_30d", "cyclomatic_max"],
            max: 1000,
          },
        ],
      });
      expect(result.violations.map((v) => v.nodeId)).toEqual(["complete.ts"]);
    } finally {
      db.close();
    }
  });

  it("supports more than two metrics", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNode(snapshotId, { id: "f.ts", kind: "file", name: "" });
      db.insertMetrics(snapshotId, [
        { nodeId: "f.ts", name: "a", value: 2 },
        { nodeId: "f.ts", name: "b", value: 3 },
        { nodeId: "f.ts", name: "c", value: 5 },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          { type: "metric-product-max", id: "r", metrics: ["a", "b", "c"], max: 29 },
        ],
      });
      expect(result.violations[0]!.value).toBe(30);
    } finally {
      db.close();
    }
  });

  it("respects kind and exclude filters", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "src/foo.ts", kind: "file", name: "" },
        { id: "src/__tests__/bar.test.ts", kind: "file", name: "" },
        { id: "mod", kind: "module", name: "" },
      ]);
      const big = [
        { name: "x", value: 100 },
        { name: "y", value: 100 },
      ];
      for (const id of ["src/foo.ts", "src/__tests__/bar.test.ts", "mod"]) {
        db.insertMetrics(snapshotId, big.map((m) => ({ nodeId: id, ...m })));
      }
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "metric-product-max",
            id: "r",
            metrics: ["x", "y"],
            max: 100,
            kind: "file",
            exclude: ["__tests__"],
          },
        ],
      });
      expect(result.violations.map((v) => v.nodeId)).toEqual(["src/foo.ts"]);
    } finally {
      db.close();
    }
  });
});

describe("runChecks — forbid-import", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  it("flags imports matching the from→to pattern", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "render/foo.ts", kind: "file", name: "" },
        { id: "cli/bar.ts", kind: "file", name: "" },
        { id: "render/baz.ts", kind: "file", name: "" },
      ]);
      db.insertEdges(snapshotId, [
        { srcId: "render/foo.ts", dstId: "cli/bar.ts", kind: "imports" },
        { srcId: "render/foo.ts", dstId: "render/baz.ts", kind: "imports" },
      ]);
    });

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [
          {
            type: "forbid-import",
            id: "no-render-to-cli",
            from: "render/**",
            to: "cli/**",
          },
        ],
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.nodeId).toBe("render/foo.ts");
      expect(result.violations[0]!.destinationId).toBe("cli/bar.ts");
    } finally {
      db.close();
    }
  });
});

describe("runChecks — layered-deps", () => {
  let fixture: Fixture;
  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  const layers: string[][] = [
    ["core"],
    ["analyzer", "graph"],
    ["render"],
    ["cli"],
  ];

  it("flags low-layer importing high-layer", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "core/foo.ts", kind: "file", name: "" },
        { id: "cli/bar.ts", kind: "file", name: "" },
      ]);
      db.insertEdge(snapshotId, {
        srcId: "core/foo.ts",
        dstId: "cli/bar.ts",
        kind: "imports",
      });
    });
    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [{ id: "layers", type: "layered-deps", layers }],
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.nodeId).toBe("core/foo.ts");
      expect(result.violations[0]!.destinationId).toBe("cli/bar.ts");
      expect(result.violations[0]!.message).toContain("layer 0");
      expect(result.violations[0]!.message).toContain("layer 3");
    } finally {
      db.close();
    }
  });

  it("allows same-layer cross-package imports", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "analyzer/a.ts", kind: "file", name: "" },
        { id: "graph/b.ts", kind: "file", name: "" },
      ]);
      db.insertEdge(snapshotId, {
        srcId: "analyzer/a.ts",
        dstId: "graph/b.ts",
        kind: "imports",
      });
    });
    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [{ id: "layers", type: "layered-deps", layers }],
      });
      expect(result.violations).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("allows high-layer importing low-layer (normal direction)", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "cli/a.ts", kind: "file", name: "" },
        { id: "core/b.ts", kind: "file", name: "" },
      ]);
      db.insertEdge(snapshotId, {
        srcId: "cli/a.ts",
        dstId: "core/b.ts",
        kind: "imports",
      });
    });
    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [{ id: "layers", type: "layered-deps", layers }],
      });
      expect(result.violations).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("skips edges where either side is not in any layer (externals, etc.)", async () => {
    fixture = await createFixture((db, snapshotId) => {
      db.insertNodes(snapshotId, [
        { id: "core/foo.ts", kind: "file", name: "" },
        { id: "npm:lodash", kind: "external", name: "lodash" },
      ]);
      db.insertEdge(snapshotId, {
        srcId: "core/foo.ts",
        dstId: "npm:lodash",
        kind: "imports",
      });
    });
    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: fixture.snapshotId,
        rules: [{ id: "layers", type: "layered-deps", layers }],
      });
      expect(result.violations).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("runChecks — baseline", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  async function createTwoSnapshotFixture(
    populateBaseline: (db: GraphDatabase, snapshotId: number) => void,
    populateHead: (db: GraphDatabase, snapshotId: number) => void,
  ): Promise<{ fixture: Fixture; baselineId: number; headId: number }> {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-baseline-"));
    const dbPath = path.join(dir, "graph.db");
    const db = openDatabase(dbPath);
    const baselineId = db.createSnapshot({ ref: "baseline", indexVersion: "0.1.0" });
    populateBaseline(db, baselineId);
    const headId = db.createSnapshot({ ref: "head", indexVersion: "0.1.0" });
    populateHead(db, headId);
    db.close();
    return { fixture: { dir, dbPath, snapshotId: headId }, baselineId, headId };
  }

  it("marks identical violations as carryover and lets passed=true", async () => {
    const built = await createTwoSnapshotFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "huge.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "huge.ts", name: "loc", value: 9000 });
      },
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "huge.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "huge.ts", name: "loc", value: 9001 });
      },
    );
    fixture = built.fixture;

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: built.headId,
        rules: [{ id: "r", type: "metric-max", metric: "loc", max: 500 }],
        baselineSnapshotId: built.baselineId,
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.isCarryover).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.carryoverErrors).toBe(1);
      expect(result.newErrors).toBe(0);
    } finally {
      db.close();
    }
  });

  it("flags violations not present in baseline as new and fails when error severity", async () => {
    const built = await createTwoSnapshotFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "old.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "old.ts", name: "loc", value: 9000 });
      },
      (db, snapshotId) => {
        db.insertNodes(snapshotId, [
          { id: "old.ts", kind: "file", name: "" },
          { id: "new.ts", kind: "file", name: "" },
        ]);
        db.insertMetrics(snapshotId, [
          { nodeId: "old.ts", name: "loc", value: 9000 },
          { nodeId: "new.ts", name: "loc", value: 1234 },
        ]);
      },
    );
    fixture = built.fixture;

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: built.headId,
        rules: [{ id: "r", type: "metric-max", metric: "loc", max: 500 }],
        baselineSnapshotId: built.baselineId,
      });
      expect(result.violations).toHaveLength(2);
      const byNode = new Map(result.violations.map((v) => [v.nodeId, v]));
      expect(byNode.get("old.ts")!.isCarryover).toBe(true);
      expect(byNode.get("new.ts")!.isCarryover).toBeUndefined();
      expect(result.passed).toBe(false);
      expect(result.newErrors).toBe(1);
      expect(result.carryoverErrors).toBe(1);
    } finally {
      db.close();
    }
  });

  it("treats forbid-import violations as carryover when the edge existed at baseline", async () => {
    const built = await createTwoSnapshotFixture(
      (db, snapshotId) => {
        db.insertNodes(snapshotId, [
          { id: "render/a.ts", kind: "file", name: "" },
          { id: "cli/b.ts", kind: "file", name: "" },
        ]);
        db.insertEdge(snapshotId, {
          srcId: "render/a.ts",
          dstId: "cli/b.ts",
          kind: "imports",
        });
      },
      (db, snapshotId) => {
        db.insertNodes(snapshotId, [
          { id: "render/a.ts", kind: "file", name: "" },
          { id: "render/c.ts", kind: "file", name: "" },
          { id: "cli/b.ts", kind: "file", name: "" },
        ]);
        db.insertEdges(snapshotId, [
          { srcId: "render/a.ts", dstId: "cli/b.ts", kind: "imports" },
          { srcId: "render/c.ts", dstId: "cli/b.ts", kind: "imports" },
        ]);
      },
    );
    fixture = built.fixture;

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: built.headId,
        rules: [
          {
            id: "no-r2c",
            type: "forbid-import",
            from: "render/**",
            to: "cli/**",
          },
        ],
        baselineSnapshotId: built.baselineId,
      });
      expect(result.violations).toHaveLength(2);
      const carry = result.violations.filter((v) => v.isCarryover);
      const fresh = result.violations.filter((v) => !v.isCarryover);
      expect(carry).toHaveLength(1);
      expect(carry[0]!.nodeId).toBe("render/a.ts");
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.nodeId).toBe("render/c.ts");
      expect(result.passed).toBe(false);
    } finally {
      db.close();
    }
  });

  it("ignores violations that exist only in baseline (no head equivalent)", async () => {
    const built = await createTwoSnapshotFixture(
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "gone.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "gone.ts", name: "loc", value: 9999 });
      },
      (db, snapshotId) => {
        db.insertNode(snapshotId, { id: "kept.ts", kind: "file", name: "" });
        db.insertMetric(snapshotId, { nodeId: "kept.ts", name: "loc", value: 1 });
      },
    );
    fixture = built.fixture;

    const db = openDatabase(fixture.dbPath);
    try {
      const result = runChecks(db, {
        snapshotId: built.headId,
        rules: [{ id: "r", type: "metric-max", metric: "loc", max: 500 }],
        baselineSnapshotId: built.baselineId,
      });
      expect(result.violations).toEqual([]);
      expect(result.passed).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("validateRules", () => {
  it("rejects non-object input", () => {
    expect(() => validateRules(null)).toThrow();
    expect(() => validateRules("hi")).toThrow();
  });

  it("rejects rules without id, type, or required fields", () => {
    expect(() => validateRules({ rules: [{ type: "metric-max" }] })).toThrow(/id/);
    expect(() => validateRules({ rules: [{ id: "r" }] })).toThrow(/type/);
    expect(() => validateRules({ rules: [{ id: "r", type: "metric-max", metric: "loc" }] })).toThrow(/max/);
    expect(() => validateRules({ rules: [{ id: "r", type: "unknown" }] })).toThrow(/unknown type/);
  });

  it("validates and returns normalized rules", () => {
    const rules = validateRules({
      rules: [
        { id: "a", type: "metric-max", metric: "loc", max: 100, exclude: ["t"] },
        { id: "b", type: "forbid-import", from: "x/**", to: "y/**" },
      ],
    }) as CheckRule[];
    expect(rules).toHaveLength(2);
    expect(rules[0]!.type).toBe("metric-max");
    expect(rules[1]!.type).toBe("forbid-import");
  });

  it("rejects layered-deps with fewer than 2 layers", () => {
    expect(() =>
      validateRules({
        rules: [{ id: "r", type: "layered-deps", layers: [["core"]] }],
      }),
    ).toThrow(/2\+/);
  });

  it("rejects layered-deps with a package in multiple layers", () => {
    expect(() =>
      validateRules({
        rules: [
          {
            id: "r",
            type: "layered-deps",
            layers: [["core"], ["analyzer", "core"]],
          },
        ],
      }),
    ).toThrow(/"core" appears in more than one layer/);
  });

  it("rejects unknown role values in excludeRoles", () => {
    expect(() =>
      validateRules({
        rules: [
          {
            id: "r",
            type: "metric-max",
            metric: "loc",
            max: 1,
            excludeRoles: ["banana"],
          },
        ],
      }),
    ).toThrow(/unknown role/);
  });

  it("rejects metric-product-max with fewer than 2 metrics or non-string entries", () => {
    expect(() =>
      validateRules({
        rules: [{ id: "r", type: "metric-product-max", metrics: ["a"], max: 1 }],
      }),
    ).toThrow(/2\+/);
    expect(() =>
      validateRules({
        rules: [
          { id: "r", type: "metric-product-max", metrics: ["a", 7], max: 1 },
        ],
      }),
    ).toThrow(/strings/);
  });

  it("normalizes a metric-product-max rule", () => {
    const [rule] = validateRules({
      rules: [
        {
          id: "scary",
          type: "metric-product-max",
          metrics: ["churn_30d", "cyclomatic_max"],
          max: 1000,
          kind: "file",
          exclude: ["__tests__"],
        },
      ],
    });
    expect(rule).toEqual({
      type: "metric-product-max",
      id: "scary",
      metrics: ["churn_30d", "cyclomatic_max"],
      max: 1000,
      kind: "file",
      severity: undefined,
      exclude: ["__tests__"],
    });
  });
});
