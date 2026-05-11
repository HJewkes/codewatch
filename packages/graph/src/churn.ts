import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { GraphMetric } from "./types.js";

export interface ChurnEntry {
  commit: string;
  author: string;
  filePath: string;
  added: number;
  deleted: number;
}

export interface ComputeChurnOptions {
  repoRoot: string;
  windowDays?: number;
  knownFileIds?: ReadonlySet<string>;
}

const DEFAULT_WINDOW_DAYS = 30;
const COMMIT_HASH_RE = /^[0-9a-f]{7,40}$/;
const NUMSTAT_FIRST_RE = /^(\d+|-)$/;

export function computeChurnMetrics(options: ComputeChurnOptions): GraphMetric[] {
  const entries = loadChurnEntries(options) ?? [];
  return aggregateChurn(
    entries,
    options.windowDays ?? DEFAULT_WINDOW_DAYS,
    options.knownFileIds,
  );
}

/**
 * Parse the last `windowDays` of git history into ChurnEntry[] rebased onto
 * `repoRoot`. Returns null if git isn't available; [] if no commits matched.
 * Used both for churn metrics and for change-coupling.
 */
export function loadChurnEntries(
  options: ComputeChurnOptions,
): ChurnEntry[] | null {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const gitRoot = detectGitToplevel(options.repoRoot);
  if (gitRoot === null) return null;
  const log = runGitLog(options.repoRoot, windowDays);
  if (log === null) return null;
  const canonicalRoot = canonicalize(options.repoRoot);
  return parseChurnLog(log).flatMap((entry) =>
    rebaseEntry(entry, gitRoot, canonicalRoot),
  );
}

function rebaseEntry(
  entry: ChurnEntry,
  gitRoot: string,
  rootDir: string,
): ChurnEntry[] {
  const abs = path.resolve(gitRoot, entry.filePath);
  const rel = path.relative(rootDir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return [];
  return [{ ...entry, filePath: toPosix(rel) }];
}

function canonicalize(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function parseChurnLog(text: string): ChurnEntry[] {
  const out: ChurnEntry[] = [];
  let commit = "";
  let author = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length === 2 && COMMIT_HASH_RE.test(parts[0]!)) {
      commit = parts[0]!;
      author = parts[1]!;
      continue;
    }
    if (parts.length === 3 && commit && NUMSTAT_FIRST_RE.test(parts[0]!)) {
      const added = parts[0] === "-" ? 0 : Number(parts[0]);
      const deleted = parts[1] === "-" ? 0 : Number(parts[1]);
      const filePath = resolveRenamedPath(parts[2]!);
      out.push({ commit, author, filePath, added, deleted });
    }
  }
  return out;
}

export function resolveRenamedPath(rawPath: string): string {
  const braceMatch = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rawPath);
  if (braceMatch) {
    const [, prefix, , newSeg, suffix] = braceMatch;
    return collapseSlashes(`${prefix}${newSeg}${suffix}`);
  }
  const arrow = rawPath.indexOf(" => ");
  if (arrow >= 0) return rawPath.slice(arrow + 4);
  return rawPath;
}

export function aggregateChurn(
  entries: readonly ChurnEntry[],
  windowDays: number,
  knownFileIds?: ReadonlySet<string>,
): GraphMetric[] {
  const lines = new Map<string, number>();
  const commits = new Map<string, Set<string>>();
  const authors = new Map<string, Set<string>>();
  for (const e of entries) {
    if (knownFileIds && !knownFileIds.has(e.filePath)) continue;
    lines.set(e.filePath, (lines.get(e.filePath) ?? 0) + e.added + e.deleted);
    setAdd(commits, e.filePath, e.commit);
    setAdd(authors, e.filePath, e.author);
  }
  const suffix = `${windowDays}d`;
  const out: GraphMetric[] = [];
  for (const [filePath, total] of lines) {
    out.push({ nodeId: filePath, name: `churn_${suffix}`, value: total, unit: "lines" });
    out.push({
      nodeId: filePath,
      name: `churn_${suffix}_commits`,
      value: commits.get(filePath)!.size,
      unit: "count",
    });
    out.push({
      nodeId: filePath,
      name: `churn_${suffix}_authors`,
      value: authors.get(filePath)!.size,
      unit: "count",
    });
  }
  return out;
}

function setAdd(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function collapseSlashes(s: string): string {
  return s.replace(/\/+/g, "/");
}

function detectGitToplevel(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function runGitLog(repoRoot: string, windowDays: number): string | null {
  try {
    return execFileSync(
      "git",
      [
        "log",
        `--since=${windowDays}.days.ago`,
        "--no-merges",
        "--numstat",
        "-M",
        "--pretty=format:%H%x09%an",
      ],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return null;
  }
}
