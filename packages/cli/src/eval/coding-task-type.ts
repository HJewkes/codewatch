import type { EditFileScreen } from "./coding-screen.js";
import type { CodingTaskType } from "./impact-types.js";

/**
 * Rule-assigned grep-hard task type (C-86 plan, mining step 4). The rules only
 * propose a type; hand review confirms it. T1 (option threading) and T2
 * (data-contract propagation) have no structural rule, so they are never
 * assigned here. When no rule fires, or the rules disagree, the type is unset.
 */

type RuleResult = CodingTaskType | "undecided" | null;

const INDEX_FILE_RE = /(^|\/)index\.[cm]?[jt]sx?$/;
const MIN_SWEEP_SIBLINGS = 3;

export function assignTaskType(files: readonly EditFileScreen[]): CodingTaskType | undefined {
  const sweepDirs = siblingSweepDirs(files);
  const fired = [
    barrelRule(files),
    sweepDirs.size > 0 ? "T6" : null,
    deepLogicRule(files, sweepDirs),
  ].filter((r): r is CodingTaskType | "undecided" => r !== null);
  const [first] = fired;
  if (first === undefined || first === "undecided") return undefined;
  return fired.every((r) => r === first) ? first : undefined;
}

function isBarrel(f: EditFileScreen): boolean {
  return f.light !== "added" && INDEX_FILE_RE.test(f.path);
}

/** A changed barrel: T4 when the commit adds a unit to register, T3 when parallel barrels change together. */
function barrelRule(files: readonly EditFileScreen[]): RuleResult {
  const barrels = files.filter(isBarrel).length;
  if (barrels === 0) return null;
  if (files.some((f) => f.light === "added")) return "T4";
  return barrels >= 2 ? "T3" : "undecided";
}

/**
 * Directories holding 3 or more modified, non-barrel edit files: one behaviour
 * adopted by every sibling consumer (T6).
 */
function siblingSweepDirs(files: readonly EditFileScreen[]): Set<string> {
  const perDir = new Map<string, number>();
  for (const f of files) {
    if (f.light === "added" || isBarrel(f)) continue;
    perDir.set(dirOf(f.path), (perDir.get(dirOf(f.path)) ?? 0) + 1);
  }
  return new Set([...perDir].filter(([, n]) => n >= MIN_SWEEP_SIBLINGS).map(([d]) => d));
}

/** A dark logic edit 2 or more hops from the tests (T5), not counting the files of a sweep. */
function deepLogicRule(files: readonly EditFileScreen[], sweepDirs: ReadonlySet<string>): RuleResult {
  const deep = files.some(
    (f) =>
      f.hunkKind === "logic" && f.hop !== null && f.hop >= 2 && !sweepDirs.has(dirOf(f.path)),
  );
  return deep ? "T5" : null;
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
