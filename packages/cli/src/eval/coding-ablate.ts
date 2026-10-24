import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { resetTo, runVitestJson, type VitestRunOptions } from "./coding-grade.js";
import type { Adjudication, VitestTest } from "./coding-types.js";

/**
 * C-86 S4 ablation necessity gate. At the fix commit, restore one dark file at
 * a time to its parent content and ask which oracle notices: the `failToPass`
 * tests first, then (optionally) `tsc`. A dark file neither oracle notices is
 * unadjudicated: an arm can go green without touching it.
 *
 * The decision functions are pure and unit-tested; `ablateDarkFiles` shells
 * only through the injected `AblateDeps`.
 */

// --- pure decision logic ----------------------------------------------------

export interface AblationProbe {
  testsFail: boolean;
  /** `null` when tsc was not run (no command given, or the tests already failed). */
  typeFails: boolean | null;
}

/** Test-pass is the headline oracle, so it outranks the type check. */
export function adjudicate(probe: AblationProbe): Adjudication {
  if (probe.testsFail) return "test";
  if (probe.typeFails === true) return "type";
  return "none";
}

/**
 * Whether the ablated tree breaks any `failToPass` test. A missing result
 * counts as broken: a restored file that stops the test file from loading is
 * the tests noticing it, and the environment already ran green at the fix
 * commit in the admission gate.
 */
export function testsBroken(failToPass: readonly string[], results: readonly VitestTest[]): boolean {
  const passed = new Set(results.filter((t) => t.status === "pass").map((t) => t.id));
  return failToPass.some((id) => !passed.has(id));
}

/** The test files the `failToPass` ids (`<file> :: <name>`) live in. */
export function failToPassFiles(failToPass: readonly string[]): string[] {
  return [...new Set(failToPass.map((id) => id.split(" :: ")[0]!))];
}

// --- shell wrapper ------------------------------------------------------------

export interface AblateOptions {
  parentCommit: string;
  fixCommit: string;
  darkFiles: readonly string[];
  failToPass: readonly string[];
  /** Type-check argv, e.g. `["pnpm", "exec", "tsc", "--noEmit", "-p", "<pkg>"]`. */
  tsc?: readonly string[];
  vitest?: VitestRunOptions;
}

export interface AblateDeps {
  reset: (workdir: string, ref: string) => void;
  restore: (workdir: string, ref: string, file: string) => void;
  runTests: (workdir: string, testFiles: readonly string[], vitest?: VitestRunOptions) => VitestTest[];
  /** True when the type check is clean. */
  typecheck: (argv: readonly string[], workdir: string) => boolean;
}

const SHELL_DEPS: AblateDeps = {
  reset: resetTo,
  restore: restoreFromRef,
  runTests: runVitestJson,
  typecheck: typecheckClean,
};

/**
 * Adjudicate each dark file against a workdir with dependencies installed.
 * Leaves the workdir at the fix commit.
 */
export function ablateDarkFiles(
  workdir: string,
  opts: AblateOptions,
  deps: AblateDeps = SHELL_DEPS,
): Record<string, Adjudication> {
  const testFiles = failToPassFiles(opts.failToPass);
  const out: Record<string, Adjudication> = {};
  for (const file of opts.darkFiles) {
    deps.reset(workdir, opts.fixCommit);
    deps.restore(workdir, opts.parentCommit, file);
    const testsFail = testsBroken(opts.failToPass, deps.runTests(workdir, testFiles, opts.vitest));
    const typeFails = testsFail || !opts.tsc ? null : !deps.typecheck(opts.tsc, workdir);
    out[file] = adjudicate({ testsFail, typeFails });
  }
  deps.reset(workdir, opts.fixCommit);
  return out;
}

/** A file the fix commit added has no parent content, so restoring it deletes it. */
function restoreFromRef(workdir: string, ref: string, file: string): void {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${file}`], { cwd: workdir, stdio: "ignore" });
  } catch {
    rmSync(join(workdir, file), { force: true });
    return;
  }
  execFileSync("git", ["checkout", ref, "--", file], { cwd: workdir, stdio: "ignore" });
}

function typecheckClean(argv: readonly string[], workdir: string): boolean {
  const [bin, ...args] = argv;
  try {
    execFileSync(bin!, args, { cwd: workdir, stdio: "ignore", timeout: 600_000 });
    return true;
  } catch {
    return false;
  }
}
