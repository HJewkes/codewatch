import { extractIdentifiers, isDistinctive, type DocumentFrequency } from "./coding-hardness.js";
import { readBlobs, sourceDocumentFrequency } from "./coding-git.js";
import type { EditFileScreen } from "./coding-screen.js";
import type { CodingScreen, ScreenedCandidate } from "./coding-screen-suite.js";
import {
  IMPACT_ANSWER_BUDGET,
  type CodingTaskType,
  type ImpactBuild,
  type ImpactRejection,
  type ImpactTask,
} from "./impact-types.js";

/**
 * Impact tasks from screened candidates (C-86 S5). The seed is the diff of the
 * non-dark edit files; the gold set is the dark files with a `logic` change.
 * A task whose prompt names a gold file, or a distinctive identifier of one,
 * is rejected rather than built: the arm could grep its way to it.
 */

export type ImpactCandidate = ScreenedCandidate & { type?: CodingTaskType };

export function buildImpactTask(
  c: ImpactCandidate,
  goldIdentifiers: ReadonlySet<string> = new Set(),
): ImpactBuild {
  const gold = goldFiles(c.hardness.files);
  const seedFiles = c.hardness.files.filter((f) => f.light !== "dark").map((f) => f.path);
  if (gold.length === 0) return { ok: false, reason: "no-gold" };
  if (seedFiles.length === 0) return { ok: false, reason: "no-seed" };
  const task: ImpactTask = {
    id: `impact-${c.fixCommit.slice(0, 12)}`,
    fixCommit: c.fixCommit,
    parentCommit: c.parentCommit,
    seedFiles,
    seedDiff: diffForFiles(c.goldDiff, seedFiles),
    gold,
    ...(c.type ? { type: c.type } : {}),
  };
  const leaks = findGoldLeaks(renderImpactPrompt(task), gold, seedFiles, goldIdentifiers);
  return leaks.length > 0 ? { ok: false, reason: "gold-leak", leaks } : { ok: true, task };
}

export function goldFiles(files: readonly EditFileScreen[]): string[] {
  return files.filter((f) => f.light === "dark" && f.hunkKind === "logic").map((f) => f.path);
}

/** The per-file sections of a unified diff whose new path is in `paths`. */
export function diffForFiles(diff: string, paths: readonly string[]): string {
  const keep = new Set(paths);
  const sections = diff.split(/^(?=diff --git )/m);
  return sections.filter((s) => keep.has(sectionPath(s))).join("");
}

function sectionPath(section: string): string {
  return /^diff --git a\/\S+ b\/(\S+)/.exec(section)?.[1] ?? "";
}

/** The prompt text an impact arm sees. Holds the seed diff and nothing else task-specific. */
export function renderImpactPrompt(task: ImpactTask, budget = IMPACT_ANSWER_BUDGET): string {
  return [
    "The repository is checked out with the change below already applied.",
    "For the change to be complete, other existing files must change too. Find them.",
    "Do not edit any file.",
    "",
    `Answer with a JSON array of repository-relative paths, most likely first, at most ${budget}.`,
    "Do not list the files the change below already touches.",
    "",
    "```diff",
    task.seedDiff.trimEnd(),
    "```",
    "",
  ].join("\n");
}

/**
 * Gold clues present in `text`: a gold path, its basename, a module specifier
 * ending in its stem, or an identifier only gold files contain. A basename a
 * seed file shares (two `index.ts` files) is no clue and is skipped.
 */
export function findGoldLeaks(
  text: string,
  gold: readonly string[],
  seedFiles: readonly string[],
  goldIdentifiers: ReadonlySet<string>,
): string[] {
  const seedStems = new Set(seedFiles.map((p) => stem(basename(p))));
  const leaks = gold.flatMap((path) => pathLeaks(text, path, seedStems));
  for (const id of extractIdentifiers(text)) {
    if (goldIdentifiers.has(id)) leaks.push(`identifier:${id}`);
  }
  return leaks;
}

function pathLeaks(text: string, path: string, seedStems: ReadonlySet<string>): string[] {
  const name = basename(path);
  const s = stem(name);
  const leaks = text.includes(path) ? [`path:${path}`] : [];
  if (seedStems.has(s)) return leaks;
  if (text.includes(name)) leaks.push(`basename:${name}`);
  if (specifierPattern(s).test(text)) leaks.push(`specifier:${s}`);
  return leaks;
}

function specifierPattern(fileStem: string): RegExp {
  const escaped = fileStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'/]${escaped}(\\.[cm]?[jt]sx?)?["']`);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stem(name: string): string {
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/**
 * Distinctive identifiers in the gold files' parent content. Finding 1 of the
 * plan: a task is grep-hard only when its statement shares none of these.
 */
export function distinctiveGoldIdentifiers(
  goldContents: Iterable<string>,
  df: DocumentFrequency,
): Set<string> {
  const out = new Set<string>();
  for (const src of goldContents) {
    for (const id of extractIdentifiers(src)) if (isDistinctive(id, df)) out.add(id);
  }
  return out;
}

export interface ImpactSuite {
  tasks: ImpactTask[];
  rejected: Record<ImpactRejection, number>;
}

/** Build impact tasks for a screen's candidates. Reads git only. */
export function generateImpactTasks(repo: string, screen: CodingScreen): ImpactSuite {
  const df = sourceDocumentFrequency(repo, screen.source.ref);
  const suite: ImpactSuite = { tasks: [], rejected: { "no-gold": 0, "no-seed": 0, "gold-leak": 0 } };
  for (const c of screen.candidates) {
    const gold = goldFiles(c.hardness.files);
    const contents = readBlobs(repo, c.parentCommit, gold).values();
    const built = buildImpactTask(c, distinctiveGoldIdentifiers(contents, df));
    if (built.ok) suite.tasks.push(built.task);
    else suite.rejected[built.reason]++;
  }
  return suite;
}
