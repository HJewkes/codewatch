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
  const barrel = barrelRule(files);
  const fired = [
    barrel,
    // Parallel barrels are the mirrored sites themselves; the files they re-export are not a sweep.
    sweepDirs.size > 0 && barrel !== "T3" ? "T6" : null,
    deepLogicRule(files, sweepDirs),
  ].filter((r): r is CodingTaskType | "undecided" => r !== null);
  const [first] = fired;
  if (first === undefined || first === "undecided") return undefined;
  return fired.every((r) => r === first) ? first : undefined;
}

/** An `index.*` path, or an entry module whose change only adds or drops exports. */
function isBarrel(f: EditFileScreen): boolean {
  if (f.light === "added") return false;
  return INDEX_FILE_RE.test(f.path) || f.hunkKind === "export-only";
}

/**
 * Changed barrels: one barrel plus an added unit is a registration (T4); two
 * or more dark barrels with nothing added are mirrored sites (T3). Two or
 * more barrels plus an added unit fit both, so they stay undecided, and so do
 * barrels the tests already point at.
 */
function barrelRule(files: readonly EditFileScreen[]): RuleResult {
  const barrels = files.filter(isBarrel);
  if (barrels.length === 0) return null;
  if (files.some((f) => f.light === "added")) return barrels.length === 1 ? "T4" : "undecided";
  return barrels.filter((f) => f.light === "dark").length >= 2 ? "T3" : "undecided";
}

/**
 * Directories holding 3 or more dark, non-barrel edit files: consumers the
 * tests never name, each adopting one shared change (T6). Lit siblings do not
 * count; the test already points at them.
 */
function siblingSweepDirs(files: readonly EditFileScreen[]): Set<string> {
  const perDir = new Map<string, number>();
  for (const f of files) {
    if (f.light !== "dark" || isBarrel(f)) continue;
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
