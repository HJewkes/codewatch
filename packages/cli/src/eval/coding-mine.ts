import { execFileSync } from "node:child_process";
import {
  dominantStratum,
  resolveRelativeSpecifier,
  splitTokens,
} from "./stratify.js";
import type { Stratum } from "./types.js";
import type {
  ChangeStatus,
  CommitInfo,
  FileChange,
  FilePartition,
} from "./coding-types.js";

/**
 * C-83 mining: surface single-purpose, test-carrying commits from a repo's
 * recent history as coding-task candidates. All logic here is deterministic;
 * the only side effect is reading git history (never writing). The expensive
 * fail-to-pass admission gate lives in `coding-grade.ts` — this module only
 * decides which commits are WORTH gating.
 */

/**
 * Commit subjects we reject outright — the message is used ONLY to exclude
 * (text-leakage fix: it never enters a task). Reverts, merges, releases, and
 * mechanical churn (chore/docs/style/build/deps) carry no behavioral fail-to-pass
 * signal, so they are dropped before the gate ever runs.
 */
const REJECT_SUBJECT_RE =
  /^(revert|merge|chore|docs?|style|build|ci|test|refactor|release|bump|deps?|dependabot|wip)\b|revert|^v?\d+\.\d+\.\d+/i;

/** True when a commit subject marks it as non-behavioral / unusable. */
export function shouldRejectByMessage(subject: string): boolean {
  return REJECT_SUBJECT_RE.test(subject.trim());
}

const TEST_PATH_RE = /(\.|\/)(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_DIR_RE = /(^|\/)(__tests__|__test__|tests?)\//i;
const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/i;
const DECL_EXT_RE = /\.d\.[cm]?ts$/i;

/** A `*.test.ts` / `*.spec.tsx` file, or any file under a `__tests__`/`tests` dir. */
export function isTestFile(path: string): boolean {
  return TEST_PATH_RE.test(path) || TEST_DIR_RE.test(path);
}

/** A non-test TS/JS source file (excludes `.d.ts` declarations). */
export function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false;
  if (DECL_EXT_RE.test(path)) return false;
  return SOURCE_EXT_RE.test(path);
}

/** Split a commit's changed files into test / source / everything-else buckets. */
export function partitionChangedFiles(changes: readonly FileChange[]): FilePartition {
  const testFiles: string[] = [];
  const sourceFiles: string[] = [];
  const otherFiles: string[] = [];
  for (const c of changes) {
    if (c.status === "deleted") {
      otherFiles.push(c.path);
      continue;
    }
    if (isTestFile(c.path)) testFiles.push(c.path);
    else if (isSourceFile(c.path)) sourceFiles.push(c.path);
    else otherFiles.push(c.path);
  }
  return { testFiles, sourceFiles, otherFiles };
}

export interface ScopeOptions {
  maxSourceFiles: number;
  maxChangedLoc: number;
}

/**
 * A single-purpose candidate: at least one test file AND one source file
 * changed, few enough source files, and small enough total churn that the change
 * is one logical unit. Deleted-only / non-code files are ignored by the caller's
 * partition, but their churn still counts toward the LOC budget so a giant
 * generated-file bump can't slip through under a small source diff.
 */
export function passesScope(
  part: FilePartition,
  changes: readonly FileChange[],
  opts: ScopeOptions,
): boolean {
  if (part.testFiles.length === 0 || part.sourceFiles.length === 0) return false;
  if (part.sourceFiles.length > opts.maxSourceFiles) return false;
  const churn = changes.reduce(
    (sum, c) => sum + (c.added ?? 0) + (c.deleted ?? 0),
    0,
  );
  if (churn > opts.maxChangedLoc) return false;
  return true;
}

// --- git output parsers (pure) ---------------------------------------------

/** Parse `git show --name-status -M` body into path+status pairs (new path wins). */
export function parseNameStatus(text: string): { path: string; status: ChangeStatus }[] {
  const out: { path: string; status: ChangeStatus }[] = [];
  for (const raw of text.split("\n")) {
    const entry = classifyNameStatusLine(raw.trimEnd());
    if (entry) out.push(entry);
  }
  return out;
}

/** Rename/copy report the destination path in field 2; add/delete/modify in field 1. */
const NAME_STATUS_KIND: Record<string, { status: ChangeStatus; pathIndex: 1 | 2 }> = {
  R: { status: "renamed", pathIndex: 2 },
  C: { status: "added", pathIndex: 2 },
  A: { status: "added", pathIndex: 1 },
  D: { status: "deleted", pathIndex: 1 },
  M: { status: "modified", pathIndex: 1 },
};

function classifyNameStatusLine(
  line: string,
): { path: string; status: ChangeStatus } | null {
  if (!line) return null;
  const parts = line.split("\t");
  const kind = NAME_STATUS_KIND[(parts[0] ?? "")[0] ?? ""];
  if (!kind) return null;
  const path = parts[kind.pathIndex];
  return path ? { path, status: kind.status } : null;
}

/** Parse `git show --numstat -M` body into a path→churn map (binary → null). */
export function parseNumstat(text: string): Map<string, { added: number | null; deleted: number | null }> {
  const out = new Map<string, { added: number | null; deleted: number | null }>();
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? null : Number(parts[0]);
    const deleted = parts[1] === "-" ? null : Number(parts[1]);
    // A rename shows `old => new` (possibly with `{a => b}` braces); the
    // name-status pass owns the canonical path, so index by the resolved new one.
    const path = resolveNumstatPath(parts[2]!);
    out.set(path, { added, deleted });
  }
  return out;
}

/** Collapse git's `{old => new}` / `old => new` rename notation to the new path. */
function resolveNumstatPath(raw: string): string {
  const braced = raw.replace(/\{[^}]*=>\s*([^}]*)\}/g, "$1").replace(/\/\//g, "/");
  const arrow = braced.split(" => ");
  return (arrow.length > 1 ? arrow[arrow.length - 1]! : braced).trim();
}

// --- git shell wrappers -----------------------------------------------------

function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repo,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Resolve a ref to its commit sha, or null when the ref/repo is unusable. */
export function resolveHead(repo: string, ref: string): string | null {
  try {
    return git(repo, ["rev-parse", ref]).trim();
  } catch {
    return null;
  }
}

export interface MineOptions extends ScopeOptions {
  ref: string;
  windowDays: number;
}

/**
 * List non-merge commits within the mining window, cheaply, with parent+subject.
 * The heavy per-file inspection is deferred to `loadCommitChanges` so the message
 * filter can drop most commits before we pay for their diffs.
 */
export function listWindowCommits(repo: string, opts: MineOptions): CommitInfo[] {
  const raw = git(repo, [
    "log",
    "--no-merges",
    `--since=${opts.windowDays} days ago`,
    "--format=%H%x00%P%x00%s",
    opts.ref,
  ]);
  const out: CommitInfo[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [sha, parents, subject] = line.split("\0");
    if (!sha) continue;
    out.push({
      sha,
      parent: parents ? (parents.split(" ")[0] ?? null) : null,
      subject: subject ?? "",
      changes: [],
    });
  }
  return out;
}

/** Populate a commit's `changes` by joining its name-status and numstat diffs. */
export function loadCommitChanges(repo: string, commit: CommitInfo): CommitInfo {
  const nameStatus = parseNameStatus(
    git(repo, ["show", "--no-color", "-M", "--name-status", "--format=", commit.sha]),
  );
  const numstat = parseNumstat(
    git(repo, ["show", "--no-color", "-M", "--numstat", "--format=", commit.sha]),
  );
  const changes: FileChange[] = nameStatus.map(({ path, status }) => {
    const churn = numstat.get(path);
    return { path, status, added: churn?.added ?? 0, deleted: churn?.deleted ?? 0 };
  });
  return { ...commit, changes };
}

/** Unified diff of the given paths between a commit and its parent. */
export function diffForPaths(repo: string, sha: string, paths: readonly string[]): string {
  if (paths.length === 0) return "";
  return git(repo, ["diff", "--no-color", `${sha}^`, sha, "--", ...paths]);
}

// --- stratification (reuse the committed C-82 primitives, graph-free) -------

/** Extract relative import specifiers named in a test file's raw source. */
export function extractRelativeSpecifiers(source: string): string[] {
  const out = new Set<string>();
  const re = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const spec = m[1]!;
    if (spec.startsWith(".")) out.add(spec);
  }
  return [...out];
}

/**
 * Bucket a candidate task by how discoverable its `editFiles` are from the
 * symbols/imports the test files name — reusing the committed
 * `shareNameToken` / `resolveRelativeSpecifier` / `dominantStratum` (no graph
 * needed, so the generator stays fast). Mirrors `classifyReferenceEdge`:
 *  - name-token shared between an edit file and any test → `semantic-findable`
 *  - a test's relative import resolves straight to the edit file → `import-chain-reachable`
 *  - neither → `structurally-hidden` (the barrel / re-export case codewatch owns)
 */
export function classifyEditFiles(
  editFiles: readonly string[],
  testFiles: readonly string[],
  testSources: ReadonlyMap<string, string>,
  repoFileIds: ReadonlySet<string>,
): Stratum {
  const perFile: Stratum[] = [];
  const testSpecs = new Map<string, string[]>();
  for (const tf of testFiles) {
    testSpecs.set(tf, extractRelativeSpecifiers(testSources.get(tf) ?? ""));
  }
  for (const edit of editFiles) {
    perFile.push(classifyOneEditFile(edit, testFiles, testSpecs, repoFileIds));
  }
  return dominantStratum(perFile);
}

function classifyOneEditFile(
  edit: string,
  testFiles: readonly string[],
  testSpecs: ReadonlyMap<string, string[]>,
  repoFileIds: ReadonlySet<string>,
): Stratum {
  const editTokens = splitTokens(basename(edit));
  for (const tf of testFiles) {
    if (shareNameTokenPath(tf, editTokens)) return "semantic-findable";
  }
  for (const tf of testFiles) {
    for (const spec of testSpecs.get(tf) ?? []) {
      if (resolveRelativeSpecifier(tf, spec, repoFileIds) === edit) {
        return "import-chain-reachable";
      }
    }
  }
  return "structurally-hidden";
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** True when a test file's basename shares a token with the edit file's tokens. */
function shareNameTokenPath(testFile: string, editTokens: Set<string>): boolean {
  for (const t of splitTokens(basename(testFile))) if (editTokens.has(t)) return true;
  return false;
}
