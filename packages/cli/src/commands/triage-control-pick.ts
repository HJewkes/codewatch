import { pickControls, seededRandom } from "@titan-design/evidence";
import type { Control, ControlKind, ControlLabel } from "./triage-controls/types.js";

/** The finding signals whose question each control kind exercises. */
const KIND_SIGNALS: Readonly<Record<ControlKind, readonly string[]>> = {
  "single-caller-helper": ["symbol-single-caller-helper"],
  comment: ["symbol-narrating-comments", "symbol-comment-ratio"],
  "unnecessary-isinstance": ["pyright/reportUnnecessaryIsInstance", "pyright/reportUnnecessaryCast"],
  "pass-through": ["symbol-pass-through"],
};

const KINDS = Object.keys(KIND_SIGNALS) as ControlKind[];

/** The control kinds whose question the run asks, in a stable order. */
export function kindsAsked(signals: Iterable<string>): ControlKind[] {
  const asked = new Set(signals);
  return KINDS.filter((kind) => KIND_SIGNALS[kind].some((signal) => asked.has(signal)));
}

const countLabel = (controls: readonly Control[], label: ControlLabel) => controls.filter((c) => c.label === label).length;

/** One control per kind, alternating labels from a seeded start so several kinds plant both clean and slop. */
function onePerKind(pool: readonly Control[], kinds: readonly ControlKind[], seed: string): Control[] {
  const offset = seededRandom(seed)() < 0.5 ? 0 : 1;
  return kinds.flatMap((kind, i) => {
    const ofKind = pool.filter((c) => c.kind === kind);
    const label: ControlLabel = (i + offset) % 2 === 0 ? "clean" : "slop";
    const preferred = ofKind.filter((c) => c.label === label);
    return pickControls(preferred.length > 0 ? preferred : ofKind, `${seed}:${kind}`, 1);
  });
}

/** Fills up to `total` from the unpicked pool, topping up whichever label is short of half. */
function fillBalanced(pool: readonly Control[], picked: readonly Control[], seed: string, total: number): Control[] {
  const rest = pool.filter((c) => !picked.includes(c));
  const cleanNeed = Math.max(0, Math.floor(total / 2) - countLabel(picked, "clean"));
  const clean = pickControls(rest.filter((c) => c.label === "clean"), seed, Math.min(cleanNeed, total - picked.length));
  const slop = pickControls(rest.filter((c) => c.label === "slop"), seed, total - picked.length - clean.length);
  return [...clean, ...slop];
}

/** Plants at least one control per question kind the run asks, then fills to `n` by seed; `n` of 0 plants none. */
export function pickRunControls(pool: readonly Control[], signals: Iterable<string>, seed: string, n: number): Control[] {
  if (n === 0) return [];
  const kinds = kindsAsked(signals).filter((kind) => pool.some((c) => c.kind === kind));
  const guaranteed = onePerKind(pool, kinds, seed);
  const total = Math.max(n, guaranteed.length);
  return [...guaranteed, ...fillBalanced(pool, guaranteed, seed, total)];
}
