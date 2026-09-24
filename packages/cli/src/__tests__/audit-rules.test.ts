import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openCodeGraph,
  snapshotViolations,
  type CheckRule,
  type CodeGraphStore,
  type NodeKind,
} from "@titan-design/code-graph";
import { AUDIT_RULES } from "../commands/audit-rules.js";

function auditRule(id: string): CheckRule {
  const rule = AUDIT_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`no audit rule ${id}`);
  return rule;
}

let dir: string;
let store: CodeGraphStore;
let snapshotId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "c106-rules-"));
  store = openCodeGraph(join(dir, "graph.db"));
  snapshotId = store.createSnapshot({ ref: "main", indexVersion: "0.18.0" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed(kind: NodeKind, metric: string, values: readonly number[]): void {
  const ids = values.map((_, i) => (kind === "file" ? `pkg/m${i}.py` : `pkg/m.py#f${i}`));
  store.insertNodes(snapshotId, ids.map((id) => ({ id, kind, name: id })));
  store.insertMetrics(snapshotId, ids.map((nodeId, i) => ({ nodeId, name: metric, value: values[i] })));
}

function flaggedValues(ruleId: string, metric: string): number[] {
  return snapshotViolations(store, snapshotId, [auditRule(ruleId)])
    .map((v) => store.listMetricsForNode(snapshotId, v.nodeId).find((m) => m.name === metric)?.value ?? NaN)
    .sort((a, b) => a - b);
}

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
const repeat = (n: number, value: number): number[] => Array.from({ length: n }, () => value);

describe("audit rule table", () => {
  it("replaces the two stopgap thresholds with outlier rules and adds the call-graph rules", () => {
    const ids = ["symbol-comment-ratio", "file-except-density", "symbol-single-caller-helper", "symbol-constant-params"];
    expect(ids.map(auditRule)).toEqual([
      { type: "metric-outlier", id: "symbol-comment-ratio", metric: "symbol_comment_ratio", kind: "symbol", percentile: 90, rankNonZero: true, floor: 0.5, severity: "warning" },
      { type: "metric-outlier", id: "file-except-density", metric: "except_density", kind: "file", percentile: 90, rankNonZero: true, floor: 3, severity: "warning" },
      { type: "metric-max", id: "symbol-single-caller-helper", metric: "symbol_single_caller_helper", max: 0, kind: "symbol", severity: "warning" },
      { type: "metric-max", id: "symbol-constant-params", metric: "symbol_constant_params", max: 0, kind: "symbol", severity: "warning" },
    ]);
  });
});

describe("call-graph audit rules", () => {
  it("flags a helper with one caller and not one with several", () => {
    seed("symbol", "symbol_single_caller_helper", [1, 0]);
    expect(flaggedValues("symbol-single-caller-helper", "symbol_single_caller_helper")).toEqual([1]);
  });

  it("flags a callable with a constant parameter and not one without", () => {
    seed("symbol", "symbol_constant_params", [0, 2]);
    expect(flaggedValues("symbol-constant-params", "symbol_constant_params")).toEqual([2]);
  });
});

describe("outlier audit rules over sparse metrics", () => {
  it("flags a comment-heavy function above the floor, not a top-decile one below it", () => {
    seed("symbol", "symbol_comment_ratio", [...zeros(100), ...repeat(20, 0.1), 0.4, 0.9]);
    expect(flaggedValues("symbol-comment-ratio", "symbol_comment_ratio")).toEqual([0.9]);
  });

  it("does not judge comment ratio when too few functions carry a non-zero value", () => {
    seed("symbol", "symbol_comment_ratio", [...zeros(100), ...repeat(5, 0.9)]);
    expect(flaggedValues("symbol-comment-ratio", "symbol_comment_ratio")).toEqual([]);
  });

  it("flags a handler-dense file above the floor, not a top-decile one below it", () => {
    seed("file", "except_density", [...zeros(100), ...repeat(20, 1), 2.9, 8]);
    expect(flaggedValues("file-except-density", "except_density")).toEqual([8]);
  });

  it("does not judge except density when too few files carry a handler", () => {
    seed("file", "except_density", [...zeros(100), ...repeat(5, 8)]);
    expect(flaggedValues("file-except-density", "except_density")).toEqual([]);
  });
});
