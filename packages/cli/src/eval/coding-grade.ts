import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import type {
  CodingResolveResult,
  StableStatus,
  VitestTest,
} from "./coding-types.js";

/**
 * C-83 admission gate + grader. The gate (`runAdmissionGate`) is the expensive,
 * essential part — a REAP-style automated-QA layer that stands in for human
 * labeling: it admits a candidate ONLY if the tests exhibit a stable fail-to-pass
 * transition (fail at parent+testPatch, pass at the fix commit) with no flaky
 * tests. The grader (`gradeCoding`) is the escape from the D2 tautology: it grades
 * an arm's edit against the repo's OWN tests — a signal codewatch never authors.
 *
 * The pure decision functions (parse / aggregate / transition / evaluate) are
 * unit-tested on fixtures; the shell wrappers that check out commits and shell
 * `pnpm exec vitest` are exercised against a real clone (see the Stage 0 note),
 * not in CI.
 */

// --- pure decision logic ----------------------------------------------------

interface VitestJsonAssertion {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status?: string;
}
interface VitestJsonFile {
  name?: string;
  assertionResults?: VitestJsonAssertion[];
}
interface VitestJsonReport {
  testResults?: VitestJsonFile[];
}

function statusOf(raw: string | undefined): VitestTest["status"] {
  if (raw === "passed") return "pass";
  if (raw === "failed") return "fail";
  return "skip";
}

function fullNameOf(a: VitestJsonAssertion): string {
  if (a.fullName && a.fullName.length > 0) return a.fullName;
  return [...(a.ancestorTitles ?? []), a.title ?? ""].filter(Boolean).join(" > ");
}

/**
 * Parse a `vitest --reporter=json` report into per-test outcomes. `rootDir`
 * relativizes each file's absolute `name` so a test's id is stable across
 * different checkout directories. Malformed / empty input yields `[]`.
 */
export function parseVitestJson(raw: string, rootDir: string): VitestTest[] {
  let report: VitestJsonReport;
  try {
    report = JSON.parse(extractJsonObject(raw)) as VitestJsonReport;
  } catch {
    return [];
  }
  const out: VitestTest[] = [];
  for (const file of report.testResults ?? []) {
    const rel = file.name ? relative(rootDir, file.name) : "";
    for (const a of file.assertionResults ?? []) {
      const name = fullNameOf(a);
      out.push({ id: `${rel} :: ${name}`, file: rel, name, status: statusOf(a.status) });
    }
  }
  return out;
}

/** vitest may print banner lines before the JSON; slice from the first `{`. */
function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return raw;
  return raw.slice(start, end + 1);
}

/**
 * Aggregate K runs into one stable status per test id: `pass`/`fail` only if the
 * test reported that status in EVERY run it appeared in and appeared in all K
 * runs; anything else (mixed statuses, or missing from a run) is `flaky` and will
 * be excluded from both fail-to-pass and pass-to-pass sets.
 */
export function aggregateRuns(runs: readonly (readonly VitestTest[])[]): Map<string, StableStatus> {
  const k = runs.length;
  const seen = new Map<string, { statuses: Set<VitestTest["status"]>; count: number }>();
  for (const run of runs) {
    for (const t of run) {
      const rec = seen.get(t.id) ?? { statuses: new Set(), count: 0 };
      rec.statuses.add(t.status);
      rec.count += 1;
      seen.set(t.id, rec);
    }
  }
  const out = new Map<string, StableStatus>();
  for (const [id, rec] of seen) {
    if (rec.count < k || rec.statuses.size !== 1) {
      out.set(id, "flaky");
    } else {
      const only = [...rec.statuses][0]!;
      out.set(id, only === "pass" ? "pass" : only === "fail" ? "fail" : "flaky");
    }
  }
  return out;
}

export interface Transition {
  /** Stable-fail at parent+testPatch AND stable-pass at the fix commit. */
  failToPass: string[];
  /** Stable-pass in both — the regression guard. */
  passToPass: string[];
}

/**
 * The fail-to-pass transition between the parent+testPatch state and the fix
 * commit. A test contributes to `failToPass` only if it stably fails at the
 * parent and stably passes at the fix; `passToPass` requires stable-pass in both.
 * Flaky-either-side tests are silently excluded (they poison grading).
 */
export function computeTransition(
  parent: ReadonlyMap<string, StableStatus>,
  fix: ReadonlyMap<string, StableStatus>,
): Transition {
  const failToPass: string[] = [];
  const passToPass: string[] = [];
  for (const [id, before] of parent) {
    const after = fix.get(id);
    if (before === "fail" && after === "pass") failToPass.push(id);
    else if (before === "pass" && after === "pass") passToPass.push(id);
  }
  failToPass.sort();
  passToPass.sort();
  return { failToPass, passToPass };
}

/**
 * Evaluate an arm's post-edit test run against a task's oracle. `resolved` — all
 * `failToPass` green AND all `passToPass` still green — is the headline SWE-bench
 * criterion. An empty run (`results` has none of the expected tests) is a
 * `runError`, not a resolution.
 */
export function evaluateResolve(
  failToPass: readonly string[],
  passToPass: readonly string[],
  results: readonly VitestTest[],
): CodingResolveResult {
  const status = new Map(results.map((t) => [t.id, t.status]));
  const failToPassPassed: string[] = [];
  const failToPassFailed: string[] = [];
  for (const id of failToPass) {
    if (status.get(id) === "pass") failToPassPassed.push(id);
    else failToPassFailed.push(id);
  }
  const passToPassRegressed = passToPass.filter((id) => status.get(id) !== "pass");
  const runError = results.length === 0;
  const resolved =
    !runError && failToPassFailed.length === 0 && passToPassRegressed.length === 0;
  return { resolved, failToPassPassed, failToPassFailed, passToPassRegressed, runError };
}

// --- shell wrappers (side-effectful; verified against a real clone) ---------

class GitError extends Error {}

function git(workdir: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: workdir,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    throw new GitError(`git ${args.join(" ")} failed: ${(err as Error).message}`);
  }
}

/** Apply a unified diff to the workdir (`git apply`). Throws on a rejected hunk. */
export function applyPatch(workdir: string, diff: string): void {
  execFileSync("git", ["apply", "--whitespace=nowarn"], {
    cwd: workdir,
    input: diff,
    encoding: "utf-8",
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/** Hard-reset the workdir to a ref and drop untracked files, discarding edits. */
export function resetTo(workdir: string, ref: string): void {
  git(workdir, ["checkout", "-f", ref]);
  git(workdir, ["clean", "-fdq"]);
}

export interface VitestRunOptions {
  /** Run without CI-mode retries so flaky tests stay visible (Stage 0 gotcha). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Run vitest over the given test files in a workdir and parse the JSON report.
 * Returns `[]` on a runner crash (env/apply error) so callers distinguish a
 * failing-but-ran suite from a suite that never ran. `CI` is forced unset so the
 * root config's `retry: process.env.CI ? 2 : 0` yields retry-0 (flakiness stays
 * visible), per the Stage 0 note.
 */
export function runVitestJson(
  workdir: string,
  testFiles: readonly string[],
  opts: VitestRunOptions = {},
): VitestTest[] {
  const env = { ...process.env, ...opts.env };
  delete (env as Record<string, string | undefined>)["CI"];
  let raw: string;
  try {
    raw = execFileSync(
      "pnpm",
      ["exec", "vitest", "run", "--reporter=json", "--no-color", ...testFiles],
      {
        cwd: workdir,
        encoding: "utf-8",
        maxBuffer: 128 * 1024 * 1024,
        timeout: opts.timeoutMs ?? 180_000,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    // A non-zero exit is EXPECTED when tests fail — vitest still writes the JSON
    // report to stdout, so recover it from the error before giving up.
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.includes("testResults")) raw = stdout;
    else return [];
  }
  return parseVitestJson(raw, workdir);
}

export interface GateOptions {
  runs: number;
  testFiles: string[];
  testPatchDiff: string;
  parentCommit: string;
  fixCommit: string;
  vitest?: VitestRunOptions;
}

export interface GateResult {
  outcome: "admitted" | "no-transition" | "env-error";
  failToPass: string[];
  passToPass: string[];
}

/**
 * Run the fail-to-pass admission gate against a workdir that is ALREADY at the
 * parent commit with dependencies installed. Applies the test patch, runs the
 * tests K times at parent, then at the fix commit, and computes the stable
 * transition. Always resets the workdir back to the parent commit before
 * returning. Never throws — an environment failure becomes `env-error` so the
 * generator can record it in the funnel and move on.
 */
export function runAdmissionGate(workdir: string, opts: GateOptions): GateResult {
  const empty: Pick<GateResult, "failToPass" | "passToPass"> = {
    failToPass: [],
    passToPass: [],
  };
  try {
    resetTo(workdir, opts.parentCommit);
    applyPatch(workdir, opts.testPatchDiff);
    const parentRuns = repeat(opts.runs, () =>
      runVitestJson(workdir, opts.testFiles, opts.vitest),
    );
    resetTo(workdir, opts.fixCommit);
    const fixRuns = repeat(opts.runs, () =>
      runVitestJson(workdir, opts.testFiles, opts.vitest),
    );
    resetTo(workdir, opts.parentCommit);
    if (parentRuns.some((r) => r.length === 0) || fixRuns.some((r) => r.length === 0)) {
      return { outcome: "env-error", ...empty };
    }
    const { failToPass, passToPass } = computeTransition(
      aggregateRuns(parentRuns),
      aggregateRuns(fixRuns),
    );
    if (failToPass.length === 0) return { outcome: "no-transition", ...empty };
    return { outcome: "admitted", failToPass, passToPass };
  } catch {
    tryReset(workdir, opts.parentCommit);
    return { outcome: "env-error", ...empty };
  }
}

/**
 * Grade an arm's attempt: the workdir must be at the parent commit with the test
 * patch AND the agent's source edit applied. Runs the task's test files once and
 * evaluates the resolve criterion.
 */
export function gradeCoding(
  workdir: string,
  task: { testPatch: { files: string[] }; failToPass: string[]; passToPass: string[] },
  vitest?: VitestRunOptions,
): CodingResolveResult {
  const results = runVitestJson(workdir, task.testPatch.files, vitest);
  return evaluateResolve(task.failToPass, task.passToPass, results);
}

function repeat<T>(n: number, fn: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(fn());
  return out;
}

function tryReset(workdir: string, ref: string): void {
  try {
    resetTo(workdir, ref);
  } catch {
    /* best-effort cleanup */
  }
}
