import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { externalToFinding, type Finding } from "@titan-design/code-graph";

const execFileAsync = promisify(execFile);

/** `sg` is shadow-utils' setgroups on many Linux hosts, so the pack only ever runs the `ast-grep` name. */
const AST_GREP_BIN = "ast-grep";
const RULE_PREFIX = "ts-slop/";
/** Keeps each argv well under macOS's 1 MB ARG_MAX on large repos. */
const FILES_PER_RUN = 400;
const RUN_TIMEOUT_MS = 120_000;
const TS_FILE = /\.(?:[cm]?ts|tsx)$/;

export interface TsSlopRun {
  findings: Finding[];
  warnings: string[];
  /** Non-blank lines inside any match, unioned per file: SCBench's `ast_grep_flagged_loc` for this pack; null when ast-grep did not run. */
  flaggedLoc: number | null;
}

export interface TsSlopOptions {
  cwd: string;
  bin?: string;
  rulesDir?: string;
}

export type TsSlopRunner = (files: string[], options: TsSlopOptions) => Promise<TsSlopRun>;

export interface AstGrepMatch {
  ruleId: string;
  file: string;
  /** 1-indexed, inclusive. */
  startLine: number;
  endLine: number;
  message: string;
  lines: string;
}

interface AstGrepJson {
  ruleId: string;
  file: string;
  message: string;
  lines: string;
  range: { start: { line: number }; end: { line: number } };
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bundle runs from `dist/`, the sources from `src/commands/`; both sit under the package root. */
export function defaultRulesDir(): string {
  const candidates = [path.resolve(here, "../resources/ts-slop-rules"), path.resolve(here, "../../resources/ts-slop-rules")];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

export function isTsSlopTarget(file: string): boolean {
  return TS_FILE.test(file);
}

/** Every rule document in the pack, each once more as `Tsx` because an ast-grep rule binds to one grammar. */
export function loadTsSlopPack(rulesDir: string = defaultRulesDir()): string {
  const docs = readdirSync(rulesDir)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .flatMap((name) => readFileSync(path.join(rulesDir, name), "utf8").split(/^---$/m))
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0);
  const tsx = docs.map((doc) => doc.replace(/^language: TypeScript$/m, "language: Tsx"));
  return [...docs, ...tsx].join("\n---\n");
}

export function parseAstGrepStream(stdout: string): AstGrepMatch[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const hit = JSON.parse(line) as AstGrepJson;
      return {
        ruleId: hit.ruleId,
        file: hit.file,
        startLine: hit.range.start.line + 1,
        endLine: hit.range.end.line + 1,
        message: hit.message,
        lines: hit.lines,
      };
    });
}

/** Union of the non-blank lines the matches cover, summed over files. */
export function countFlaggedLines(matches: readonly AstGrepMatch[]): number {
  const byFile = new Map<string, Set<number>>();
  for (const m of matches) {
    let lines = byFile.get(m.file);
    if (!lines) byFile.set(m.file, (lines = new Set()));
    m.lines.split("\n").forEach((text, i) => {
      if (text.trim().length > 0) lines.add(m.startLine + i);
    });
  }
  return [...byFile.values()].reduce((sum, lines) => sum + lines.size, 0);
}

export function matchToFinding(m: AstGrepMatch): Finding {
  return externalToFinding({
    tool: "ast-grep",
    rule: `${RULE_PREFIX}${m.ruleId}`,
    file: m.file,
    line: m.startLine,
    endLine: m.endLine,
    message: m.message,
    severity: "warning",
  });
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function runFailure(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") return `${AST_GREP_BIN} not found; install with \`npm i -g @ast-grep/cli\` to run the TS slop rules`;
  const detail = e.stderr?.trim().split("\n")[0] || e.message;
  return `${AST_GREP_BIN}: ${detail}`;
}

async function scan(bin: string, rules: string, files: string[], cwd: string): Promise<AstGrepMatch[]> {
  const args = ["scan", "--json=stream", "--inline-rules", rules, ...files];
  const { stdout } = await execFileAsync(bin, args, { cwd, timeout: RUN_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });
  return parseAstGrepStream(stdout);
}

/** Runs the TS slop pack; a missing or failing ast-grep becomes a warning, never an error. */
export const runTsSlopRules: TsSlopRunner = async (files, options) => {
  const targets = files.filter(isTsSlopTarget);
  if (targets.length === 0) return { findings: [], warnings: [], flaggedLoc: 0 };
  const rules = loadTsSlopPack(options.rulesDir);
  const matches: AstGrepMatch[] = [];
  try {
    for (const batch of chunks(targets, FILES_PER_RUN)) matches.push(...(await scan(options.bin ?? AST_GREP_BIN, rules, batch, options.cwd)));
  } catch (err) {
    return { findings: [], warnings: [`skipped ts-slop: ${runFailure(err)}`], flaggedLoc: null };
  }
  return { findings: matches.map(matchToFinding), warnings: [], flaggedLoc: countFlaggedLines(matches) };
};
