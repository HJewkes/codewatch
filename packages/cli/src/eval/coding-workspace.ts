import { resolveRelativeSpecifier } from "./stratify.js";

/**
 * Workspace packages of a monorepo, read from its package.json files, so the
 * import walk can follow `@scope/pkg` specifiers into the package's source.
 * Pure — the caller reads the manifests (see `workspaceAt` in `coding-git.ts`).
 */

export interface WorkspacePackage {
  name: string;
  /** Path of the package's package.json; its directory is the package root. */
  manifestPath: string;
  manifest: Readonly<Record<string, unknown>>;
}

/** Workspace packages keyed by package name. */
export type Workspace = ReadonlyMap<string, WorkspacePackage>;

export const EMPTY_WORKSPACE: Workspace = new Map();

const SCOPED_SPECIFIER_RE = /^(@[^/]+\/[^/]+)(\/.+)?$/;
const BUILD_DIR_RE = /^(?:dist|lib|build|out)\//;
const DECLARATION_SUFFIX_RE = /\.d\.[cm]?ts$/;

export function isManifestPath(path: string): boolean {
  if (path.split("/").includes("node_modules")) return false;
  return path === "package.json" || path.endsWith("/package.json");
}

/** Parse manifests (path to JSON text) into a workspace; unnamed or invalid ones are skipped. */
export function parseWorkspace(manifests: ReadonlyMap<string, string>): Map<string, WorkspacePackage> {
  const out = new Map<string, WorkspacePackage>();
  for (const [manifestPath, text] of manifests) {
    const manifest = parseJsonRecord(text);
    if (typeof manifest?.name === "string") {
      out.set(manifest.name, { name: manifest.name, manifestPath, manifest });
    }
  }
  return out;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Resolve an `@scope/pkg[/subpath]` specifier to a source file of a workspace package. */
export function resolveWorkspaceSpecifier(
  specifier: string,
  workspace: Workspace,
  fileIds: ReadonlySet<string>,
): string | null {
  const m = SCOPED_SPECIFIER_RE.exec(specifier);
  if (!m) return null;
  const pkg = workspace.get(m[1]!);
  if (!pkg) return null;
  for (const target of entryTargets(pkg.manifest, m[2] ?? "")) {
    const resolved = resolveRelativeSpecifier(pkg.manifestPath, `./${target}`, fileIds);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** Candidate targets in order: the declared entries (and their source twins), then `src/`. */
function entryTargets(manifest: Readonly<Record<string, unknown>>, subpath: string): string[] {
  const root = subpath === "";
  const declared = [
    ...exportTargets(manifest.exports, root ? "." : `.${subpath}`),
    ...(root ? [manifest.types, manifest.module, manifest.main] : []),
  ].filter((t): t is string => typeof t === "string");
  const fallback = root ? ["src/index"] : [`src${subpath}`, subpath.slice(1)];
  return [...declared.flatMap(sourceTwins), ...fallback];
}

/** A built entry (`dist/x.d.ts`) usually has its source at `src/x.ts`, which is what the tree holds. */
function sourceTwins(target: string): string[] {
  const plain = target.replace(/^\.\//, "").replace(DECLARATION_SUFFIX_RE, "");
  const source = plain.replace(BUILD_DIR_RE, "src/");
  return source === plain ? [plain] : [plain, source];
}

function exportTargets(exports: unknown, key: string): string[] {
  if (typeof exports === "string") return key === "." ? [exports] : [];
  if (!isRecord(exports)) return [];
  const bySubpath = Object.keys(exports).some((k) => k.startsWith("."));
  if (!bySubpath) return key === "." ? stringLeaves(exports) : [];
  if (key in exports) return stringLeaves(exports[key]);
  return Object.entries(exports).flatMap(([pattern, target]) => patternTargets(pattern, target, key));
}

/** A single-star subpath pattern (`"./*": "./dist/*.js"`): substitute the matched part into each target. */
function patternTargets(pattern: string, target: unknown, key: string): string[] {
  const [prefix, suffix, ...extra] = pattern.split("*");
  if (prefix === undefined || suffix === undefined || extra.length > 0) return [];
  if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length) {
    return [];
  }
  const matched = key.slice(prefix.length, key.length - suffix.length);
  return stringLeaves(target).map((t) => t.replaceAll("*", matched));
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return isRecord(value) ? Object.values(value).flatMap(stringLeaves) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The workspace package that owns a file: the one with the deepest root containing it. */
export function owningPackage(path: string, workspace: Workspace): string | null {
  let best: { name: string; depth: number } | null = null;
  for (const pkg of workspace.values()) {
    const root = pkg.manifestPath.slice(0, -"package.json".length);
    if (!path.startsWith(root)) continue;
    if (best === null || root.length > best.depth) best = { name: pkg.name, depth: root.length };
  }
  return best?.name ?? null;
}

/** How many workspace packages the edit files touch; files outside every package count as one. */
export function packagesSpanned(editFiles: readonly string[], workspace: Workspace): number {
  return new Set(editFiles.map((f) => owningPackage(f, workspace))).size;
}
