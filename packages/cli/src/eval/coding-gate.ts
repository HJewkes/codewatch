import { execFileSync } from "node:child_process";
import type { Candidate } from "./coding-candidates.js";
import {
  runAdmissionGate,
  type GateOptions,
  type GateResult,
  type VitestRunOptions,
} from "./coding-grade.js";
import { selectRepoCommands, type RepoCommands } from "./coding-pm.js";

/**
 * The per-candidate gate: pick the package manager from the parent's
 * lockfiles, install once per lockfile hash, then run the admission gate with
 * that manager's (or the repo's override) test command. Shells only through
 * the injected `run` and `admit`, always as argv arrays.
 */

export type GateFn = (candidate: Candidate) => GateResult;

export interface GateSettings {
  runs: number;
  /** Per-repo test argv that replaces the package manager's default. */
  testCommand?: readonly string[];
  vitest?: VitestRunOptions;
}

export interface GateDeps {
  run: (argv: readonly string[], cwd: string) => void;
  admit: (workdir: string, opts: GateOptions) => GateResult;
}

const ENV_ERROR: GateResult = { outcome: "env-error", failToPass: [], passToPass: [] };

export function makeGate(
  workdir: string,
  settings: GateSettings,
  deps: GateDeps = { run: runArgv, admit: runAdmissionGate },
): GateFn {
  let installedHash: string | null = null;
  return (c) => {
    let commands: RepoCommands;
    try {
      commands = selectRepoCommands(c.lockfiles, settings.testCommand);
      if (installedHash !== c.lockfileHash) {
        installedHash = null;
        checkoutAndInstall(workdir, c.parentCommit, commands.install, deps.run);
        installedHash = c.lockfileHash;
      }
    } catch {
      // An unsupported lockfile or a failed install (lockfile drift, registry
      // outage) is an environment failure for this candidate, not a fatal run
      // error: the run keeps the gating done so far and moves on.
      return { ...ENV_ERROR };
    }
    return deps.admit(workdir, {
      runs: settings.runs,
      testFiles: c.testFiles,
      testPatchDiff: c.testPatchDiff,
      parentCommit: c.parentCommit,
      fixCommit: c.commit.sha,
      vitest: { ...settings.vitest, command: commands.test },
    });
  };
}

function checkoutAndInstall(
  workdir: string,
  parentCommit: string,
  install: readonly string[],
  run: GateDeps["run"],
): void {
  run(["git", "checkout", "-f", parentCommit], workdir);
  run(["git", "clean", "-fdq"], workdir);
  run(install, workdir);
}

function runArgv(argv: readonly string[], cwd: string): void {
  const [bin, ...args] = argv;
  execFileSync(bin!, args, { cwd, stdio: "ignore", timeout: 600_000 });
}
