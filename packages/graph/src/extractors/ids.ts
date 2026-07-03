import * as path from "node:path";

const TS_EXT_RE = /\.(?:tsx|ts|jsx|js|mts|cts|mjs|cjs)$/;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function repoRelative(repoRoot: string, absPath: string): string {
  const rel = path.relative(repoRoot, absPath);
  return toPosix(rel);
}

export function fileId(repoRoot: string, absPath: string): string {
  return repoRelative(repoRoot, absPath);
}

export function moduleId(repoRoot: string, absPath: string): string {
  const rel = repoRelative(repoRoot, absPath);
  return rel.replace(TS_EXT_RE, "");
}

export function parentModuleId(id: string): string | null {
  const idx = id.lastIndexOf("/");
  if (idx < 0) return null;
  return id.slice(0, idx);
}

export function packageId(name: string): string {
  return name;
}

// Symbol nodes hang under their declaring file: `<fileId>#<exportName>` (C-53).
// `#` never occurs in a posix path or a JS export identifier, so it can't
// collide with a real file id — and it is printable, unlike the NUL separators
// that made git treat files as binary (C-21).
export const SYMBOL_ID_SEP = "#";

export function symbolId(fileId: string, exportName: string): string {
  return `${fileId}${SYMBOL_ID_SEP}${exportName}`;
}

export function externalId(specifier: string): string {
  if (specifier.startsWith("node:")) {
    return specifier;
  }
  return `npm:${bareName(specifier)}`;
}

function bareName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  const slash = specifier.indexOf("/");
  return slash < 0 ? specifier : specifier.slice(0, slash);
}
