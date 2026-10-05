import { execFileSync } from "node:child_process";
import {
  distinctiveSeeds,
  documentFrequency,
  seedIdentifiers,
  testImportedFiles,
  type DocumentFrequency,
} from "./coding-hardness.js";
import { isSourceFile } from "./coding-mine.js";
import { editFileHops, importHops } from "./coding-reach.js";
import { parseDiffHunks, screenEditFiles, type EditFileScreen } from "./coding-screen.js";

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

/** Read a blob at a commit, or "" when the path does not exist there. */
export function showBlob(repo: string, commit: string, path: string): string {
  try {
    return git(repo, ["show", `${commit}:${path}`]);
  } catch {
    return "";
  }
}

export function treeFileIds(repo: string, commit: string): Set<string> {
  try {
    const out = git(repo, ["ls-tree", "-r", "--name-only", commit]);
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Read many blobs at one commit in a single `git cat-file --batch`; missing paths are absent. */
export function readBlobs(
  repo: string,
  commit: string,
  paths: readonly string[],
): Map<string, string> {
  if (paths.length === 0) return new Map();
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repo,
    input: paths.map((p) => `${commit}:${p}\n`).join(""),
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return parseCatFileBatch(out, paths);
}

function parseCatFileBatch(buf: Buffer, paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  for (const path of paths) {
    const eol = buf.indexOf(0x0a, pos);
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
  const hops = importHops(c.testFiles, treeFileIds(repo, c.sha), (paths) =>
    readBlobs(repo, c.sha, paths),
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
