import { describe, it, expect } from "vitest";
import { emptyFunnel, type Candidate } from "../coding-candidates.js";
import { makeGate, type GateDeps } from "../coding-gate.js";
import { admitCandidates } from "../coding-generate.js";
import type { GateOptions } from "../coding-grade.js";

function candidate(sha: string, lockfiles: string[], lockfileHash = "h1"): Candidate {
  return {
    commit: { sha, parent: `${sha}-parent`, subject: "fix", changes: [] },
    parentCommit: `${sha}-parent`,
    testFiles: [`src/${sha}.test.ts`],
    editFiles: [`src/${sha}.ts`],
    testPatchDiff: "diff-test",
    goldDiff: "diff-source",
    stratum: "structurally-hidden",
    hardness: {
      darkFiles: 0,
      trivialDarkFiles: 0,
      darkReachable: 0,
      maxHop: null,
      secondOrderDark: 0,
      files: [],
    },
    lockfiles,
    lockfileHash,
  };
}

function recordingDeps(failOn?: string): { deps: GateDeps; runs: string[][]; admits: GateOptions[] } {
  const runs: string[][] = [];
  const admits: GateOptions[] = [];
  const deps: GateDeps = {
    run: (argv) => {
      runs.push([...argv]);
      if (argv[0] === failOn) throw new Error("install failed");
    },
    admit: (_workdir, opts) => {
      admits.push(opts);
      return { outcome: "admitted", failToPass: ["A"], passToPass: [] };
    },
  };
  return { deps, runs, admits };
}

describe("makeGate", () => {
  it("gates a package-lock.json repo with npm ci and npm exec vitest", () => {
    const { deps, runs, admits } = recordingDeps();

    const result = makeGate("/work", { runs: 3 }, deps)(candidate("abc", ["package-lock.json"]));

    expect(result.outcome).toBe("admitted");
    expect(runs).toContainEqual(["npm", "ci", "--ignore-scripts"]);
    expect(admits[0]!.vitest?.command?.slice(0, 3)).toEqual(["npm", "exec", "--no"]);
    expect(admits[0]!.runs).toBe(3);
  });

  it("passes the per-repo test command to the admission gate", () => {
    const { deps, admits } = recordingDeps();
    const testCommand = ["npx", "vitest", "run", "--reporter=json"];

    makeGate("/work", { runs: 1, testCommand }, deps)(candidate("abc", ["pnpm-lock.yaml"]));

    expect(admits[0]!.vitest?.command).toEqual(testCommand);
  });

  it("installs once per lockfile hash", () => {
    const { deps, runs } = recordingDeps();
    const gate = makeGate("/work", { runs: 1 }, deps);

    gate(candidate("a", ["pnpm-lock.yaml"], "h1"));
    gate(candidate("b", ["pnpm-lock.yaml"], "h1"));
    gate(candidate("c", ["pnpm-lock.yaml"], "h2"));

    expect(runs.filter((argv) => argv[0] === "pnpm")).toHaveLength(2);
  });

  it("skips a candidate with no lockfile as env-error and still gates the next one", () => {
    const { deps, admits } = recordingDeps();
    const gate = makeGate("/work", { runs: 1 }, deps);
    const funnel = emptyFunnel();
    const cands = [
      candidate("none", [], "h0"),
      candidate("yarn", ["yarn.lock"], "h0"),
      candidate("npm", ["package-lock.json"], "h1"),
    ];

    const tasks = admitCandidates(cands, 25, gate, funnel);

    expect(funnel.gateEnvError).toBe(2);
    expect(funnel.admitted).toBe(1);
    expect(tasks.map((t) => t.corpus.fixCommit)).toEqual(["npm"]);
    expect(admits).toHaveLength(1);
  });

  it("records a failed install as env-error and retries the install next time", () => {
    const failing = recordingDeps("npm");
    const gate = makeGate("/work", { runs: 1 }, failing.deps);

    const first = gate(candidate("a", ["package-lock.json"]));
    gate(candidate("b", ["package-lock.json"]));

    expect(first.outcome).toBe("env-error");
    expect(failing.admits).toHaveLength(0);
    expect(failing.runs.filter((argv) => argv[0] === "npm")).toHaveLength(2);
  });
});
