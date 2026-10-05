import {
  emptyFunnel,
  mineCandidates,
  miningParams,
  resolveMiningOptions,
  type Candidate,
  type MiningOptions,
} from "./coding-candidates.js";
import { resolveHead } from "./coding-mine.js";
import { makeGate, type GateFn } from "./coding-gate.js";
import type { VitestRunOptions } from "./coding-grade.js";
import type { CodingSuite, CodingTask, AdmissionFunnel } from "./coding-types.js";
import type { Stratum } from "./types.js";
import { ALL_STRATA } from "./types.js";

/**
 * C-83 Stage A generator. `generateCodingSuite` mines a repo's recent history for
 * single-purpose, test-carrying commits and admits only those with a stable
 * fail-to-pass transition (the expensive gate). No LLM — this is the deterministic,
 * committable spine; the arm runner that spends tokens is scratch (per C-82's
 * guardrail). Mining/gate management shells git, the package manager and vitest,
 * and is verified against a real clone; the admission orchestration is
 * unit-tested via an injected gate.
 */

const GATE_DEFAULTS = { gateRuns: 3, cap: 25 };

export interface GenerateCodingOptions extends Partial<MiningOptions> {
  gateRuns?: number;
  cap?: number;
  /** Working checkout the gate mutates; defaults to `repo` itself. */
  workdir?: string;
  vitest?: VitestRunOptions;
  /** Per-repo test argv; replaces the package manager's default vitest command. */
  testCommand?: readonly string[];
}

/**
 * Synthesize a deterministic problem statement from the FAILING TESTS — never the
 * commit/PR message (text-leakage fix). Stage A emits a template; a richer
 * LLM-authored statement is a later enhancement. The agent also receives the
 * applied test patch, so this is the honest framing of the task.
 */
export function buildProblemStatement(testFiles: readonly string[]): string {
  const list = testFiles.map((f) => `  - ${f}`).join("\n");
  return [
    "One or more tests in this repository are currently failing.",
    "The failing test file(s) have been added to the working tree:",
    list,
    "",
    "Edit the source (not the tests) so that the failing tests pass, without",
    "breaking any tests that currently pass. Do not modify the test files.",
  ].join("\n");
}

/**
 * Run the admission gate over candidates (grouped by lockfile hash so the caller
 * installs once per group), emitting admitted `CodingTask`s and tallying the
 * funnel. Stops once `cap` tasks are admitted. Pure orchestration over `gate`.
 */
export function admitCandidates(
  candidates: readonly Candidate[],
  cap: number,
  gate: GateFn,
  funnel: AdmissionFunnel,
): CodingTask[] {
  const tasks: CodingTask[] = [];
  for (const c of orderByLockfile(candidates)) {
    if (tasks.length >= cap) break;
    funnel.gateRun += 1;
    const result = gate(c);
    if (result.outcome === "env-error") {
      funnel.gateEnvError += 1;
      continue;
    }
    if (result.outcome === "no-transition") {
      funnel.gateNoTransition += 1;
      continue;
    }
    funnel.admitted += 1;
    tasks.push(toTask(c, result.failToPass, result.passToPass));
  }
  return tasks;
}

/** Stable sort grouping candidates by lockfile hash (batches installs). */
function orderByLockfile(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates]
    .map((c, i) => ({ c, i }))
    .sort((a, b) =>
      a.c.lockfileHash === b.c.lockfileHash
        ? a.i - b.i
        : a.c.lockfileHash < b.c.lockfileHash
          ? -1
          : 1,
    )
    .map(({ c }) => c);
}

function toTask(c: Candidate, failToPass: string[], passToPass: string[]): CodingTask {
  const primary = c.editFiles[0] ?? c.commit.sha;
  return {
    id: `${c.commit.sha.slice(0, 9)}::${primary}`,
    corpus: {
      repo: "",
      parentCommit: c.parentCommit,
      fixCommit: c.commit.sha,
    },
    problemStatement: buildProblemStatement(c.testFiles),
    testPatch: { files: c.testFiles, diff: c.testPatchDiff },
    failToPass,
    passToPass,
    goldDiff: c.goldDiff,
    editFiles: c.editFiles,
    stratum: c.stratum,
  };
}

function countByStratum(tasks: readonly CodingTask[]): Record<Stratum, number> {
  const out = Object.fromEntries(ALL_STRATA.map((s) => [s, 0])) as Record<Stratum, number>;
  for (const t of tasks) out[t.stratum] += 1;
  return out;
}

/**
 * End-to-end Stage A entry point: mine → gate → suite. Installs dependencies once
 * per lockfile group in `workdir` (default: the repo itself), with the package
 * manager the parent's lockfile names, before gating that group's candidates. Deterministic given the same history and environment.
 */
export function generateCodingSuite(
  repo: string,
  options: GenerateCodingOptions = {},
): CodingSuite {
  const opts = {
    ...resolveMiningOptions(options),
    gateRuns: options.gateRuns ?? GATE_DEFAULTS.gateRuns,
    cap: options.cap ?? GATE_DEFAULTS.cap,
  };
  const workdir = options.workdir ?? repo;
  const headCommit = resolveHead(repo, opts.ref);
  const funnel = emptyFunnel();
  const candidates = mineCandidates(repo, opts, funnel);

  const gate = makeGate(workdir, {
    runs: opts.gateRuns,
    testCommand: options.testCommand,
    vitest: options.vitest,
  });

  const tasks = admitCandidates(candidates, opts.cap, gate, funnel).map((t) => ({
    ...t,
    corpus: { ...t.corpus, repo },
  }));

  return {
    source: { repo, ref: opts.ref, headCommit },
    params: { ...miningParams(opts), gateRuns: opts.gateRuns, cap: opts.cap },
    funnel,
    counts: { total: tasks.length, byStratum: countByStratum(tasks) },
    tasks,
  };
}
