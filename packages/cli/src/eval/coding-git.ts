import { execFileSync } from "node:child_process";
import {
  distinctiveSeeds,
  documentFrequency,
  seedIdentifiers,
  testImportedFiles,
  type DocumentFrequency,
} from "./coding-hardness.js";
import { isSourceFile } from "./coding-mine.js";
import { KNOWN_LOCKFILES } from "./coding-pm.js";
import { editFileHops, importHops } from "./coding-reach.js";
import { parseDiffHunks, screenEditFiles, type EditFileScreen } from "./coding-screen.js";
import { isManifestPath, parseWorkspace, type Workspace } from "./coding-workspace.js";

/**
 * Git reads for coding-suite mining: blobs, trees, and the inputs of the
 * hardness screen. Read-only — nothing here checks out, installs or runs tests.
 */

export function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repo,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** `-z` keeps paths unquoted, so a name holding a newline or non-ASCII byte reads back as is. */
export function treeFileIds(repo: string, commit: string): Set<string> {
  try {
    const out = git(repo, ["ls-tree", "-r", "-z", "--name-only", commit]);
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** The workspace packages declared by the package.json files at a commit. */
export function workspaceAt(repo: string, commit: string): Workspace {
  const manifests = [...treeFileIds(repo, commit)].filter(isManifestPath);
  return parseWorkspace(readBlobs(repo, commit, manifests));
}

/** The known root lockfiles present at a commit, read from its tree (not the working tree). */
export function lockfilesAt(repo: string, commit: string): string[] {
  try {
    const out = git(repo, ["ls-tree", "--name-only", commit, "--", ...KNOWN_LOCKFILES]);
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read many blobs at one commit in a single `git cat-file --batch`; missing
 * paths are absent. `-Z` delimits both input and output with NUL, so a path
 * holding a newline cannot split a request or misalign the blobs after it.
 */
export function readBlobs(
  repo: string,
  commit: string,
  paths: readonly string[],
): Map<string, string> {
  if (paths.length === 0) return new Map();
  const out = execFileSync("git", ["cat-file", "--batch", "-Z"], {
    cwd: repo,
    input: paths.map((p) => `${commit}:${p}\0`).join(""),
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return parseCatFileBatch(out, paths);
}

function parseCatFileBatch(buf: Buffer, paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  for (const path of paths) {
    const eol = buf.indexOf(0x00, pos);
    if (eol < 0) break;
    const header = /^\S+ (\S+) (\d+)$/.exec(buf.toString("utf-8", pos, eol));
    pos = eol + 1;
    if (!header) continue;
    const size = Number(header[2]);
    if (header[1] === "blob") out.set(path, buf.toString("utf-8", pos, pos + size));
    pos += size + 1;
  }
  return out;
}

/** Document frequency over every source file at `ref`. */
export function sourceDocumentFrequency(repo: string, ref: string): DocumentFrequency {
  const files = [...treeFileIds(repo, ref)].filter(isSourceFile);
  return documentFrequency(readBlobs(repo, ref, files).values());
}

export interface ScreenCommit {
  sha: string;
  parentCommit: string;
  testFiles: readonly string[];
  editFiles: readonly string[];
  goldDiff: string;
  /** Workspace packages at the parent commit; the walk follows `@scope/pkg` imports into them. */
  workspace: Workspace;
}

/** Gather one commit's screen inputs from git and screen its edit files. */
export function screenCommit(
  repo: string,
  c: ScreenCommit,
  df: DocumentFrequency,
): EditFileScreen[] {
  const parentIds = treeFileIds(repo, c.parentCommit);
  const testSources = readBlobs(repo, c.sha, c.testFiles);
  const parentContents = readBlobs(repo, c.parentCommit, c.editFiles);
  const hops = importHops(
    c.testFiles,
    new Set([...parentIds, ...c.testFiles]),
    (paths) => readTestsThenParent(repo, c.parentCommit, testSources, paths),
    c.workspace,
  );
  return screenEditFiles({
    edits: c.editFiles.map((path) => ({
      path,
      added: !parentIds.has(path),
      parentContent: parentContents.get(path) ?? "",
    })),
    ctx: {
      testFiles: c.testFiles,
      distinctiveSeeds: distinctiveSeeds(seedIdentifiers(testSources.values()), df),
      testImported: testImportedFiles(testSources, parentIds),
    },
    hunks: parseDiffHunks(c.goldDiff),
    hops: editFileHops(c.editFiles, hops),
    df,
  });
}

/**
 * The walk sees what the task's solver sees: the fix commit's tests over the
 * parent tree. Reading the fix tree would count import edges the fix itself
 * adds, so a file the solver must newly wire in would look reachable.
 */
function readTestsThenParent(
  repo: string,
  parentCommit: string,
  testSources: ReadonlyMap<string, string>,
  paths: readonly string[],
): Map<string, string> {
  const fromParent = readBlobs(repo, parentCommit, paths.filter((p) => !testSources.has(p)));
  for (const p of paths) {
    const test = testSources.get(p);
    if (test !== undefined) fromParent.set(p, test);
  }
  return fromParent;
}
