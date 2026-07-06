import { describe, it, expect } from "vitest";
import {
  admitCandidates,
  buildProblemStatement,
  type Candidate,
  type GateFn,
} from "../coding-generate.js";
import type { AdmissionFunnel, CommitInfo } from "../coding-types.js";
import type { Stratum } from "../types.js";

function emptyFunnel(): AdmissionFunnel {
  return {
    mined: 0,
    messageRejected: 0,
    scopeRejected: 0,
    gateRun: 0,
    gateNoTransition: 0,
    gateEnvError: 0,
    admitted: 0,
  };
}

function candidate(
  sha: string,
  lockfileHash: string,
  stratum: Stratum = "structurally-hidden",
): Candidate {
  const commit: CommitInfo = {
    sha,
    parent: `${sha}-parent`,
    subject: "fix: SECRET should not leak into a task",
    changes: [],
  };
  return {
    commit,
    parentCommit: `${sha}-parent`,
    testFiles: [`src/${sha}.test.ts`],
    editFiles: [`src/${sha}.ts`],
    testPatchDiff: "diff-test",
    goldDiff: "diff-source",
    stratum,
    lockfileHash,
  };
}

describe("buildProblemStatement", () => {
  it("names the failing test files and forbids editing tests", () => {
    const stmt = buildProblemStatement(["a.test.ts", "b.test.ts"]);
    expect(stmt).toContain("a.test.ts");
    expect(stmt).toContain("b.test.ts");
    expect(stmt).toMatch(/do not modify the test files/i);
  });
});

describe("admitCandidates", () => {
  it("tallies the funnel across admit / no-transition / env-error", () => {
    const cands = [
      candidate("aaa", "lock1"),
      candidate("bbb", "lock1"),
      candidate("ccc", "lock1"),
    ];
    const gate: GateFn = (c) => {
      if (c.commit.sha === "aaa") {
        return { outcome: "admitted", failToPass: ["A"], passToPass: ["B"] };
      }
      if (c.commit.sha === "bbb") {
        return { outcome: "no-transition", failToPass: [], passToPass: [] };
      }
      return { outcome: "env-error", failToPass: [], passToPass: [] };
    };
    const funnel = emptyFunnel();
    const tasks = admitCandidates(cands, 25, gate, funnel);
    expect(tasks).toHaveLength(1);
    expect(funnel).toMatchObject({
      gateRun: 3,
      admitted: 1,
      gateNoTransition: 1,
      gateEnvError: 1,
    });
  });

  it("stops gating once the cap is reached", () => {
    const cands = [candidate("aaa", "l"), candidate("bbb", "l"), candidate("ccc", "l")];
    let calls = 0;
    const gate: GateFn = () => {
      calls += 1;
      return { outcome: "admitted", failToPass: ["A"], passToPass: [] };
    };
    const funnel = emptyFunnel();
    const tasks = admitCandidates(cands, 2, gate, funnel);
    expect(tasks).toHaveLength(2);
    expect(calls).toBe(2); // capped — third candidate never gated
  });

  it("groups gate calls by lockfile hash to batch installs", () => {
    const cands = [
      candidate("a1", "lockA"),
      candidate("b1", "lockB"),
      candidate("a2", "lockA"),
    ];
    const order: string[] = [];
    const gate: GateFn = (c) => {
      order.push(c.lockfileHash);
      return { outcome: "no-transition", failToPass: [], passToPass: [] };
    };
    admitCandidates(cands, 25, gate, emptyFunnel());
    expect(order).toEqual(["lockA", "lockA", "lockB"]); // same-hash adjacent
  });

  it("emits a task with a stable id and no commit-message leakage", () => {
    const gate: GateFn = () => ({
      outcome: "admitted",
      failToPass: ["A"],
      passToPass: ["B"],
    });
    const [task] = admitCandidates([candidate("abc123def", "l")], 25, gate, emptyFunnel());
    expect(task!.id).toBe("abc123def::src/abc123def.ts");
    expect(task!.failToPass).toEqual(["A"]);
    expect(task!.corpus.parentCommit).toBe("abc123def-parent");
    expect(JSON.stringify(task)).not.toContain("SECRET");
  });
});
