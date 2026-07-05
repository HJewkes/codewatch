import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { detectGitToplevel, discoveryEnv } from "./git-renames.js";
import { windowSuffix, type ChurnWindow } from "./churn-window.js";
import type { GraphMetric } from "./types.js";

export { windowSuffix, type ChurnWindow };

export interface ChurnEntry {
  commit: string;
  /** Author identity — git author email (%ae); stable across name spelling drift. */
  author: string;
  /** Committer time (%ct), epoch seconds — lets one wide log be sliced per window. */
  epoch: number;
  filePath: string;
  added: number;
  deleted: number;
}

export interface ComputeChurnOptions {
  repoRoot: string;
  windowDays?: ChurnWindow;
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
  let epoch = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    // A numstat row is `added<TAB>deleted<TAB>path`: both leading fields are a
    // number-or-`-`. A commit header is `hash<TAB>email<TAB>ct` (or the legacy
    // 2-field `hash<TAB>email`), whose second field is never numstat-shaped —
    // so checking numstat first disambiguates the two 3-field line kinds.
    if (
      parts.length === 3 &&
      commit &&
      NUMSTAT_FIRST_RE.test(parts[0]!) &&
      NUMSTAT_FIRST_RE.test(parts[1]!)
    ) {
      const added = parts[0] === "-" ? 0 : Number(parts[0]);
      const deleted = parts[1] === "-" ? 0 : Number(parts[1]);
      const filePath = resolveRenamedPath(parts[2]!);
      out.push({ commit, author, epoch, filePath, added, deleted });
      continue;
    }
    if (parts.length >= 2 && COMMIT_HASH_RE.test(parts[0]!)) {
      commit = parts[0]!;
      author = parts[1]!;
      epoch = parts.length >= 3 ? Number(parts[2]) : 0;
      continue;
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
  windowDays: ChurnWindow,
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
  const suffix = windowSuffix(windowDays);
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

/** Entries whose commit landed within the last `windowDays` of `nowEpoch`. */
export function entriesWithin(
  entries: readonly ChurnEntry[],
  windowDays: number,
  nowEpoch: number,
): ChurnEntry[] {
  const cutoff = nowEpoch - windowDays * 86400;
  return entries.filter((e) => e.epoch >= cutoff);
}

/**
 * Emit churn metrics for several windows from one wide log: slice `entries` by
 * commit time per window and aggregate each slice independently. Storing
 * churn_{30,90,180}d side by side is what lets the dashboard window switcher
 * resolve a wider window instead of snapping back to the only stored one.
 */
export function aggregateChurnWindows(
  entries: readonly ChurnEntry[],
  windowsDays: readonly ChurnWindow[],
  nowEpoch: number,
  knownFileIds?: ReadonlySet<string>,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  for (const windowDays of windowsDays) {
    // Lifetime = the whole wide log (all history); finite windows slice by time.
    const within =
      windowDays === "lifetime" ? entries : entriesWithin(entries, windowDays, nowEpoch);
    out.push(...aggregateChurn(within, windowDays, knownFileIds));
  }
  return out;
}

/**
 * Earliest commit time (epoch seconds) per path, from one reverse-ordered pass
 * over full history — the first commit that touched a path ≈ its birth. Rebased
 * onto `repoRoot` and filtered to `knownFileIds` when given. Renames slightly
 * underestimate age (pre-rename history lives under the old path). Returns null
 * when git is unavailable, so callers degrade to "no age discount".
 */
export function loadFileFirstSeen(
  options: ComputeChurnOptions,
): Map<string, number> | null {
  const gitRoot = detectGitToplevel(options.repoRoot);
  if (gitRoot === null) return null;
  const log = runFirstSeenLog(options.repoRoot);
  if (log === null) return null;
  const canonicalRoot = canonicalize(options.repoRoot);
  const firstSeen = new Map<string, number>();
  let epoch = 0;
  for (const rawLine of log.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length === 2 && COMMIT_HASH_RE.test(parts[0]!)) {
      epoch = Number(parts[1]);
      continue;
    }
    if (!epoch) continue;
    const rel = path.relative(canonicalRoot, path.resolve(gitRoot, resolveRenamedPath(line)));
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const id = toPosix(rel);
    if (options.knownFileIds && !options.knownFileIds.has(id)) continue;
    if (!firstSeen.has(id)) firstSeen.set(id, epoch); // --reverse ⇒ first wins
  }
  return firstSeen;
}

/**
 * Age-discount metrics for each churned file: `file_age_days` (whole days since
 * first commit) and `recency_{window}d` = min(1, age/window). Multiplying a
 * hotspot score by recency stops a freshly-authored file's burst of churn from
 * reading as decay — a file younger than the window is discounted proportionally,
 * one older than it is unaffected (recency = 1).
 *
 * `recency_{window}d` is emitted for EVERY churned file (defaulting to 1 when its
 * first-seen date is unknown) so the scary-hotspots rule, which requires all its
 * factors present, is never silently disabled by a missing age. `file_age_days`
 * is emitted only when the age is actually known. `nowEpoch` is passed in so the
 * result is deterministic.
 */
export function computeRecencyMetrics(
  firstSeen: ReadonlyMap<string, number>,
  churnedFileIds: Iterable<string>,
  windowDays: number,
  nowEpoch: number,
): GraphMetric[] {
  return computeRecencyWindows(
    firstSeen,
    new Map([[windowDays, new Set(churnedFileIds)]]),
    nowEpoch,
  );
}

/**
 * Multi-window recency: `recency_{w}d` for each file that churned in window `w`,
 * plus a single `file_age_days` per file (window-independent). A file younger
 * than a window is discounted proportionally in that window and undiscounted
 * (recency = 1) in windows it predates, so the age-discount stays honest across
 * every window the dashboard switcher can show.
 */
export function computeRecencyWindows(
  firstSeen: ReadonlyMap<string, number>,
  churnedIdsByWindow: ReadonlyMap<ChurnWindow, ReadonlySet<string>>,
  nowEpoch: number,
): GraphMetric[] {
  const out: GraphMetric[] = [];
  const ageEmitted = new Set<string>();
  for (const [windowDays, ids] of churnedIdsByWindow) {
    const suffix = windowSuffix(windowDays);
    for (const id of ids) {
      const seen = firstSeen.get(id);
      let recency = 1;
      if (seen !== undefined) {
        const ageDays = Math.max(0, (nowEpoch - seen) / 86400);
        // Lifetime has no window to age against → recency stays 1 (no discount).
        if (windowDays !== "lifetime") recency = Math.min(1, ageDays / windowDays);
        if (!ageEmitted.has(id)) {
          out.push({ nodeId: id, name: "file_age_days", value: Math.round(ageDays), unit: "days" });
          ageEmitted.add(id);
        }
      }
      out.push({ nodeId: id, name: `recency_${suffix}`, value: Math.round(recency * 1000) / 1000, unit: "ratio" });
    }
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

/**
 * Full-history, oldest-first log of (commit, epoch) + touched paths, used to
 * find each path's first appearance. `--reverse` so the first time a path is
 * seen is its birth; `--no-renames` keeps name lines as bare paths.
 */
function runFirstSeenLog(repoRoot: string): string | null {
  try {
    return execFileSync(
      "git",
      [
        "log",
        "--reverse",
        "--no-merges",
        "--no-renames",
        "--name-only",
        "--pretty=format:%H%x09%ct",
      ],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        env: discoveryEnv(),
      },
    );
  } catch {
    return null;
  }
}

function runGitLog(repoRoot: string, windowDays: ChurnWindow): string | null {
  // Lifetime drops `--since` entirely (mirrors runFirstSeenLog) → full history.
  const sinceArgs = windowDays === "lifetime" ? [] : [`--since=${windowDays}.days.ago`];
  try {
    return execFileSync(
      "git",
      [
        "log",
        ...sinceArgs,
        "--no-merges",
        "--numstat",
        "-M",
        // %ae (author email) is a more stable identity than %an (display name):
        // names drift across spelling variants ("Henry Jewkes" / "hjewkes" /
        // bot or squash-merge display names) and inflate distinct-author counts.
        // %ct (committer time) lets one wide log be sliced into narrower windows.
        "--pretty=format:%H%x09%ae%x09%ct",
      ],
      {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        env: discoveryEnv(),
      },
    );
  } catch {
    return null;
  }
}
