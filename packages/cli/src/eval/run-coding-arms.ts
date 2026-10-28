import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseSymbolId, type CodeGraphStore } from "@titan-design/code-graph";
import { contextBundleFromDb } from "../commands/graph-context.js";
import { symbolSpansByFile } from "../commands/triage-source.js";
import { openGraphStore } from "../utils/graph-store.js";
import { armSpec, codewatchMcpConfig } from "./coding-arms.js";
import { runArms, writeArmOutputs, type ArmRunnerDeps } from "./coding-arms-runner.js";
import { lockfilesAt } from "./coding-git.js";
import { applyPatch, gradeCoding, resetTo } from "./coding-grade.js";
import { buildInjection } from "./coding-inject.js";
import { parseTestCommand, selectRepoCommands } from "./coding-pm.js";
import type { CodingSuite, CodingTask } from "./coding-types.js";

/**
 * C-93 S5 entry (keep-or-drop: the C-83 runner was scratch because it spends tokens). Every arm
 * run spawns `claude -p` and SPENDS MONEY; it mutates `--workdir` (checkout, install, edits), so
 * point it at a clone you don't mind resetting. Build first (`pnpm -r build`), then:
 *   tsx packages/cli/src/eval/run-coding-arms.ts --suite <suite.json> --workdir <clone> \
 *     --out <results.json> [--arms A0,AI,A2] [--model sonnet] [--max-turns 30] \
 *     [--cli packages/cli/dist/index.js] [--idx-dir <dir>] [--index-scope packages] \
 *     [--test-command "..."] [--always-load]
 * Writes results.json to `--out` and report.md beside it.
 */

const USAGE =
  "usage: run-coding-arms --suite <suite.json> --workdir <clone> --out <results.json> " +
  "[--arms A0,AI,A2] [--model sonnet] [--max-turns 30] [--cli <dist/index.js>] [--idx-dir <dir>] " +
  "[--index-scope packages] [--test-command <argv>] [--always-load]";

interface Settings {
  suitePath: string;
  workdir: string;
  out: string;
  arms: string[];
  model: string;
  maxTurns: number;
  cli: string;
  idxDir: string;
  indexScope: string[];
  testCommand?: string[];
  alwaysLoad: boolean;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function required(name: string): string {
  const value = arg(name);
  if (value) return value;
  process.stderr.write(`error: --${name} is required\n${USAGE}\n`);
  process.exit(1);
}

function list(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseSettings(): Settings {
  const out = resolve(required("out"));
  return {
    suitePath: required("suite"),
    workdir: resolve(required("workdir")),
    out,
    arms: list(arg("arms", "A0,AI,A2")!),
    model: arg("model", "sonnet")!,
    maxTurns: Number(arg("max-turns", "30")),
    cli: resolve(arg("cli", "packages/cli/dist/index.js")!),
    idxDir: resolve(arg("idx-dir", join(dirname(out), "idx"))!),
    indexScope: list(arg("index-scope", "packages")!),
    testCommand: parseTestCommand(arg("test-command")),
    alwaysLoad: process.argv.includes("--always-load"),
  };
}

function shell(argv: readonly string[], cwd: string, input?: string): string {
  return execFileSync(argv[0]!, argv.slice(1), {
    cwd,
    input,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
}

/** Installs dependencies once per distinct lockfile blob at the task's parent. */
function installer(s: Settings): (task: CodingTask) => void {
  let installed = "";
  return (task) => {
    const parent = task.corpus.parentCommit;
    const lockfiles = lockfilesAt(s.workdir, parent);
    const key = lockfiles.map((l) => shell(["git", "rev-parse", `${parent}:${l}`], s.workdir).trim()).join(",");
    if (key === installed) return;
    resetTo(s.workdir, parent);
    shell(selectRepoCommands(lockfiles).install, s.workdir);
    installed = key;
  };
}

interface ParentIndex {
  dbPath: string;
  store: CodeGraphStore;
  spans: ReturnType<typeof symbolSpansByFile>;
}

function indexer(s: Settings): (task: CodingTask) => ParentIndex {
  const open = new Map<string, ParentIndex>();
  return (task) => {
    const parent = task.corpus.parentCommit;
    const cached = open.get(parent);
    if (cached) return cached;
    mkdirSync(s.idxDir, { recursive: true });
    const dbPath = join(s.idxDir, `${parent.slice(0, 12)}.db`);
    if (!existsSync(dbPath)) buildIndex(s, dbPath);
    const store = openGraphStore(dbPath);
    const snapshot = store.listSnapshots({ limit: 1 })[0];
    const nodes = snapshot ? store.listNodes(snapshot.id, { includeSymbols: true }) : [];
    const index = { dbPath, store, spans: symbolSpansByFile(nodes) };
    open.set(parent, index);
    return index;
  };
}

/** Indexes the tree as it stands, so `prepare` builds it before any agent edit (test files become seeds). */
function buildIndex(s: Settings, dbPath: string): void {
  const targets = s.indexScope.map((t) => join(s.workdir, t));
  shell(["node", s.cli, "graph", "index", ...targets, "--db", dbPath, "--no-incremental"], s.workdir);
}

function lineOf(index: ParentIndex): (nodeId: string) => number | undefined {
  return (nodeId) => {
    const parsed = parseSymbolId(nodeId);
    return parsed ? index.spans.get(parsed.fileId)?.find((sp) => sp.symbol === parsed.name)?.lineStart : undefined;
  };
}

function injectionFor(s: Settings, indexFor: (task: CodingTask) => ParentIndex) {
  return (task: CodingTask) => {
    const index = indexFor(task);
    const bundleFor = (seed: string) => {
      try {
        return contextBundleFromDb(index.store, seed, { db: index.dbPath }, s.workdir);
      } catch {
        return null;
      }
    };
    return buildInjection(task, bundleFor, { lineOf: lineOf(index) });
  };
}

function mcpConfigFor(s: Settings, indexFor: (task: CodingTask) => ParentIndex) {
  return (task: CodingTask) => {
    const config = codewatchMcpConfig({ cliPath: s.cli, dbPath: indexFor(task).dbPath, repoRoot: s.workdir, alwaysLoad: s.alwaysLoad });
    const path = join(s.idxDir, `mcp-${task.corpus.parentCommit.slice(0, 12)}.json`);
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return path;
  };
}

/** Source edits only: the test patch's own files are excluded, untracked new files included. */
function agentDiff(s: Settings) {
  return (task: CodingTask): string | null => {
    try {
      shell(["git", "add", "--all", "--intent-to-add"], s.workdir);
      const excludes = task.testPatch.files.map((f) => `:(exclude)${f}`);
      return shell(["git", "diff", "HEAD", "--", ".", ...excludes], s.workdir);
    } catch {
      return null;
    }
  };
}

function runClaude(s: Settings) {
  return (args: readonly string[], input: string): string => {
    const r = spawnSync("claude", args, { cwd: s.workdir, input, encoding: "utf-8", timeout: 900_000, maxBuffer: 256 * 1024 * 1024 });
    return r.stdout ?? "";
  };
}

function realDeps(s: Settings): ArmRunnerDeps {
  const install = installer(s);
  const indexFor = indexer(s);
  return {
    runClaude: runClaude(s),
    prepare: (task) => {
      install(task);
      resetTo(s.workdir, task.corpus.parentCommit);
      applyPatch(s.workdir, task.testPatch.diff);
      indexFor(task);
    },
    agentDiff: agentDiff(s),
    grade: (task) => gradeCoding(s.workdir, task, { command: s.testCommand }),
    injectionFor: injectionFor(s, indexFor),
    mcpConfigFor: mcpConfigFor(s, indexFor),
    spansFor: (task) => (path) => indexFor(task).spans.get(path) ?? [],
    log: (line) => process.stderr.write(`${line}\n`),
  };
}

function main(): void {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const s = parseSettings();
  const specs = s.arms.map(armSpec);
  const suite = JSON.parse(readFileSync(s.suitePath, "utf-8")) as CodingSuite;
  const results = runArms(suite.tasks, specs, s, realDeps(s));
  const written = writeArmOutputs(s.out, { suite: s.suitePath, model: s.model, maxTurns: s.maxTurns, arms: s.arms, results });
  process.stderr.write(`wrote ${results.length} arm-runs to ${written.resultsPath} and ${written.reportPath}\n`);
}

main();
