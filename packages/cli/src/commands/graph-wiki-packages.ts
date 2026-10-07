import * as fs from "node:fs";
import * as path from "node:path";
import type { PackageRoot } from "@titan-design/code-graph";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".codewatch",
  "coverage",
]);

/**
 * Walk the repo for package.json files (excluding root + node_modules) and
 * return them as PackageRoot entries. The root manifest is intentionally
 * skipped — top-level repos are typically aggregator workspaces, not where
 * source lives. If the walk finds nothing, falls back to top-level
 * directories that contain code.
 */
export function detectPackages(repoRoot: string): PackageRoot[] {
  const found: PackageRoot[] = [];
  walkForManifests(repoRoot, repoRoot, found);
  if (found.length > 0) return found.sort(byId);
  return fallbackTopLevelDirs(repoRoot).sort(byId);
}

function walkForManifests(
  root: string,
  dir: string,
  acc: PackageRoot[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const hasManifest = entries.some(
    (e) => e.isFile() && e.name === "package.json",
  );
  if (hasManifest && dir !== root) {
    acc.push(buildPackageRoot(root, dir));
    return; // don't descend further into a package
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith(".")) continue;
    walkForManifests(root, path.join(dir, e.name), acc);
  }
}

function buildPackageRoot(root: string, dir: string): PackageRoot {
  const id = toPosix(path.relative(root, dir));
  const name = readPackageName(path.join(dir, "package.json")) ?? path.basename(dir);
  return { id, name };
}

function readPackageName(manifestPath: string): string | null {
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

function fallbackTopLevelDirs(repoRoot: string): PackageRoot[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => ({ id: e.name, name: e.name }));
}

function byId(a: PackageRoot, b: PackageRoot): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
