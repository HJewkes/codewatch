import { describe, it, expect } from "vitest";
import {
  aggregateRuns,
  computeTransition,
  evaluateResolve,
  parseVitestJson,
} from "../coding-grade.js";
import type { VitestTest } from "../coding-types.js";

const t = (id: string, status: VitestTest["status"]): VitestTest => ({
  id,
  file: id.split(" :: ")[0]!,
  name: id.split(" :: ")[1]!,
  status,
});

describe("parseVitestJson", () => {
  const report = JSON.stringify({
    testResults: [
      {
        name: "/abs/root/packages/x/a.test.ts",
        assertionResults: [
          { fullName: "adds one", status: "passed" },
          { ancestorTitles: ["group"], title: "y", status: "failed" },
        ],
      },
    ],
  });
  it("relativizes files and maps vitest statuses", () => {
    expect(parseVitestJson(report, "/abs/root")).toEqual([
      { id: "packages/x/a.test.ts :: adds one", file: "packages/x/a.test.ts", name: "adds one", status: "pass" },
      { id: "packages/x/a.test.ts :: group > y", file: "packages/x/a.test.ts", name: "group > y", status: "fail" },
    ]);
  });
  it("recovers JSON printed after a banner and tolerates junk", () => {
    expect(parseVitestJson(`stderr noise\n${report}\n`, "/abs/root")).toHaveLength(2);
    expect(parseVitestJson("not json at all", "/abs/root")).toEqual([]);
  });
});

describe("aggregateRuns", () => {
  it("marks consistently-passing / failing tests and flags flaky ones", () => {
    const agg = aggregateRuns([
      [t("f :: p", "pass"), t("f :: q", "fail"), t("f :: r", "pass")],
      [t("f :: p", "pass"), t("f :: q", "fail"), t("f :: r", "fail")],
    ]);
    expect(agg.get("f :: p")).toBe("pass");
    expect(agg.get("f :: q")).toBe("fail");
    expect(agg.get("f :: r")).toBe("flaky"); // pass then fail
  });
  it("flags a test missing from some runs as flaky", () => {
    const agg = aggregateRuns([[t("f :: a", "pass")], []]);
    expect(agg.get("f :: a")).toBe("flaky"); // appeared in 1 of 2 runs
  });
});

describe("computeTransition", () => {
  it("keeps stable fail→pass and pass→pass, drops flaky either side", () => {
    const parent = new Map([
      ["A", "fail"],
      ["B", "pass"],
      ["C", "flaky"],
      ["D", "fail"],
    ] as const);
    const fix = new Map([
      ["A", "pass"],
      ["B", "pass"],
      ["C", "pass"],
      ["D", "fail"],
    ] as const);
    expect(computeTransition(parent, fix)).toEqual({
      failToPass: ["A"],
      passToPass: ["B"],
    });
  });
});

describe("evaluateResolve", () => {
  const failToPass = ["A"];
  const passToPass = ["B"];
  it("resolves when failToPass passes and passToPass holds", () => {
    const r = evaluateResolve(failToPass, passToPass, [t("A", "pass"), t("B", "pass")]);
    expect(r.resolved).toBe(true);
    expect(r.failToPassPassed).toEqual(["A"]);
  });
  it("is unresolved when a failToPass test still fails", () => {
    const r = evaluateResolve(failToPass, passToPass, [t("A", "fail"), t("B", "pass")]);
    expect(r.resolved).toBe(false);
    expect(r.failToPassFailed).toEqual(["A"]);
  });
  it("is unresolved when a passToPass test regresses", () => {
    const r = evaluateResolve(failToPass, passToPass, [t("A", "pass"), t("B", "fail")]);
    expect(r.resolved).toBe(false);
    expect(r.passToPassRegressed).toEqual(["B"]);
  });
  it("flags an empty run as a runError, not a resolution", () => {
    const r = evaluateResolve(failToPass, passToPass, []);
    expect(r.runError).toBe(true);
    expect(r.resolved).toBe(false);
  });
});
