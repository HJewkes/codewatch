import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { armPrompt, buildClaudeArgs, type ArmSpec } from "./coding-arms.js";
import type { Injection } from "./coding-inject.js";
import { parseArmStream } from "./coding-ledger.js";
import { parseDiffLocations, scoreLocalization, scoreReadLocalization, type SpansFor } from "./coding-localize.js";
import { renderArmReport, summarizeArms, type ArmRun } from "./coding-report.js";
import type { CodingResolveResult, CodingTask } from "./coding-types.js";

/**
 * C-93 S5: runs each task under each arm and records the graded, ledgered result. Every side
 * effect arrives through `ArmRunnerDeps`, so `runClaude` is the only path to a model and tests
 * pass a fake. The entry script `run-coding-arms.ts` wires the real process, git and index.
 */

export interface ArmRunnerDeps {
  /** Run `claude` with this argv and stdin in the workdir; returns its stream-json stdout. */
  runClaude(args: readonly string[], input: string): string;
  /** Put the workdir at the task's parent commit with its test patch applied. */
  prepare(task: CodingTask): void;
  /** The agent's source diff against the parent, test files excluded; null when unreadable. */
  agentDiff(task: CodingTask): string | null;
  grade(task: CodingTask): CodingResolveResult;
  /** Called for an injecting arm only. */
  injectionFor(task: CodingTask): Injection;
  /** Path to the MCP config; called for an MCP arm only. */
  mcpConfigFor(task: CodingTask): string;
  /** Symbol spans in the task's parent-commit index. */
  spansFor(task: CodingTask): SpansFor;
  log(line: string): void;
}

export interface ArmRunnerOptions {
  model: string;
  maxTurns: number;
  workdir: string;
}

/** An arm run plus the estimated tokens of its injected block (0 for a non-injecting arm). */
export type ArmRunRecord = ArmRun & { injectedTokens: number };

export interface ArmResults {
  suite: string;
  model: string;
  maxTurns: number;
  arms: string[];
  results: ArmRunRecord[];
}

const NO_INJECTION: Injection = { text: "", citations: [], estimatedTokens: 0 };

function agentTurn(spec: ArmSpec, task: CodingTask, opts: ArmRunnerOptions, deps: ArmRunnerDeps) {
  const injection = spec.injectsContext ? deps.injectionFor(task) : NO_INJECTION;
  const mcpConfigPath = spec.usesMcp ? deps.mcpConfigFor(task) : undefined;
  const args = buildClaudeArgs(spec, { ...opts, mcpConfigPath });
  const stdout = deps.runClaude(args, armPrompt(spec, task.problemStatement, injection));
  return { ledgers: parseArmStream(stdout, opts.model), injectedTokens: injection.estimatedTokens };
}

function localizationOf(task: CodingTask, diff: string | null, deps: ArmRunnerDeps) {
  if (diff === null) return { localization: null, editedFiles: [] };
  return {
    localization: scoreLocalization(task.goldDiff, diff, deps.spansFor(task)),
    editedFiles: parseDiffLocations(diff).map((l) => l.file),
  };
}

export function runArm(spec: ArmSpec, task: CodingTask, opts: ArmRunnerOptions, deps: ArmRunnerDeps): ArmRunRecord {
  deps.prepare(task);
  const { ledgers, injectedTokens } = agentTurn(spec, task, opts, deps);
  const located = localizationOf(task, deps.agentDiff(task), deps);
  const grade = deps.grade(task);
  return {
    taskId: task.id,
    arm: spec.id,
    stratum: task.stratum,
    resolved: grade.resolved,
    runError: grade.runError,
    failToPassPassed: grade.failToPassPassed.length,
    failToPassTotal: task.failToPass.length,
    passToPassRegressed: grade.passToPassRegressed.length,
    main: ledgers.main,
    helper: ledgers.helper,
    sessionTotal: ledgers.resultTotal,
    ledgerGap: ledgers.ledgerGap,
    costUsd: ledgers.costUsd,
    numTurns: ledgers.numTurns,
    toolCalls: ledgers.toolCalls,
    ...located,
    preEditTurns: ledgers.preEditTurns,
    readLocalization: scoreReadLocalization(task.goldDiff, ledgers.readFiles, opts.workdir),
    injectedTokens,
  };
}

function runLine(run: ArmRunRecord): string {
  const outcome = run.resolved ? "RESOLVED" : run.runError ? "run-error" : "unresolved";
  return `  ${run.arm}: ${outcome} | f2p ${run.failToPassPassed}/${run.failToPassTotal} | main in ${run.main.inputTokens} | $${run.costUsd.toFixed(3)}`;
}

/** Every task under every arm, in suite order; each task's arms run back to back on one checkout. */
export function runArms(
  tasks: readonly CodingTask[],
  specs: readonly ArmSpec[],
  opts: ArmRunnerOptions,
  deps: ArmRunnerDeps,
): ArmRunRecord[] {
  const results: ArmRunRecord[] = [];
  tasks.forEach((task, i) => {
    deps.log(`[${i + 1}/${tasks.length}] ${task.id}`);
    for (const spec of specs) {
      const run = runArm(spec, task, opts, deps);
      deps.log(runLine(run));
      results.push(run);
    }
  });
  return results;
}

/** Writes the raw results to `outPath` and the rendered arm report to `report.md` beside it. */
export function writeArmOutputs(outPath: string, payload: ArmResults): { resultsPath: string; reportPath: string } {
  const reportPath = join(dirname(outPath), "report.md");
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(reportPath, renderArmReport(summarizeArms(payload.results)));
  return { resultsPath: outPath, reportPath };
}
