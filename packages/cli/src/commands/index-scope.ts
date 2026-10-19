import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { workingTreeSource, type IndexSource } from "@titan-design/code-graph";

/**
 * Tool-owned directories that hold installed or generated code. An untracked file under
 * one is never the project's source, even when no ignore rule covers it (C-216).
 */
export const UNTRACKED_ENV_DIRS: ReadonlySet<string> = new Set([
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "node_modules",
  ".tox",
]);

const MAX_LISTING_BYTES = 512 * 1024 * 1024;

type FileFilter = (abs: string) => boolean;

/** Paths under `root`, as `root`-joined absolute paths, or null when `root` is not in a git work tree. */
function gitListFiles(root: string, args: readonly string[]): string[] | null {
  try {
    const out = execFileSync("git", ["ls-files", "-z", ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_LISTING_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter((rel) => rel !== "").map((rel) => path.join(root, rel));
  } catch {
    return null;
  }
}

/** A virtualenv is any directory holding `pyvenv.cfg`, whatever it is named. */
function envDirFilter(root: string): FileFilter {
  const isVenv = new Map<string, boolean>();
  const venvAt = (dir: string): boolean => {
    let known = isVenv.get(dir);
    if (known === undefined) isVenv.set(dir, (known = existsSync(path.join(dir, "pyvenv.cfg"))));
    return known;
  };
  return (abs) => {
    const dirs = path.relative(root, path.dirname(abs)).split(path.sep).filter((s) => s !== "");
    if (dirs.some((name) => UNTRACKED_ENV_DIRS.has(name))) return false;
    return !dirs.some((_, i) => venvAt(path.join(root, ...dirs.slice(0, i + 1))));
  };
}

/**
 * What `root` contributes to the index: in a git work tree, tracked files plus untracked
 * files no ignore rule covers and no tool env holds; outside git, every walked file no tool
 * env holds. Untracked files count because a solve's new modules are often uncommitted.
 */
function rootFilter(root: string): FileFilter {
  const outsideEnv = envDirFilter(root);
  const tracked = gitListFiles(root, ["--cached"]);
  const untracked = gitListFiles(root, ["--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) return outsideEnv;
  const inScope = new Set([...tracked, ...untracked.filter(outsideEnv)]);
  return (abs) => inScope.has(abs);
}

function isUnder(root: string, abs: string): boolean {
  return abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** Keeps the walked files that belong to the project under one of `rootDirs`. */
export function scopeToProject(files: readonly string[], rootDirs: readonly string[]): string[] {
  const filters = rootDirs.map((root) => ({ root, accepts: rootFilter(root) }));
  return files.filter((abs) => filters.some(({ root, accepts }) => isUnder(root, abs) && accepts(abs)));
}

/** The working tree, listing only the project's own files (see {@link scopeToProject}). */
export function projectWorkingTreeSource(base: IndexSource = workingTreeSource()): IndexSource {
  return {
    listFiles: async (rootDirs, languages) => scopeToProject(await base.listFiles(rootDirs, languages), rootDirs),
    readFile: (abs) => base.readFile(abs),
    fileExists: (abs) => base.fileExists(abs),
    get fileSystem() {
      return base.fileSystem;
    },
  };
}
