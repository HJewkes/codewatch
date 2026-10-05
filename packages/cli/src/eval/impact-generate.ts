import { extractIdentifiers, isDistinctive, type DocumentFrequency } from "./coding-hardness.js";
import { readBlobs, sourceDocumentFrequency } from "./coding-git.js";
import type { EditFileScreen } from "./coding-screen.js";
import type { CodingScreen, ScreenedCandidate } from "./coding-screen-suite.js";
import { diffSections, findGoldLeaks } from "./impact-leaks.js";
import {
  IMPACT_ANSWER_BUDGET,
  type ImpactBuild,
  type ImpactRejection,
  type ImpactTask,
} from "./impact-types.js";

/**
 * Impact tasks from screened candidates (C-86 S5). The seed is the diff of the
 * non-dark edit files; the gold set is the dark files with a `logic` change.
 * A task whose seed diff points at a gold file (see `impact-leaks.ts`) is
 * rejected rather than built: the arm could grep its way to it.
 */

export type ImpactCandidate = ScreenedCandidate;

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
  const leaks = findGoldLeaks(task, goldIdentifiers);
  return leaks.length > 0 ? { ok: false, reason: "gold-leak", leaks } : { ok: true, task };
}

export function goldFiles(files: readonly EditFileScreen[]): string[] {
  return files.filter((f) => f.light === "dark" && f.hunkKind === "logic").map((f) => f.path);
}

/** The per-file sections of a unified diff whose new path is in `paths`. */
export function diffForFiles(diff: string, paths: readonly string[]): string {
  const keep = new Set(paths);
  return diffSections(diff)
    .filter(([path]) => keep.has(path))
    .map(([, section]) => section)
    .join("");
}

/**
 * The prompt text an impact arm sees. The seed diff is its only task-specific
 * part, so `findGoldLeaks` checks that and not the fixed wording around it.
 */
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
