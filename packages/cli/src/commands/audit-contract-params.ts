import type { Param } from "./audit-contract-facts.js";

/** One call's arguments as code-graph records them on a `calls` edge (call-sites.ts). */
export interface CallSite {
  args: readonly unknown[];
  kwargs?: Readonly<Record<string, unknown>>;
  spreadFrom?: number;
  kwSplat?: boolean;
}

export interface ParamChange {
  kind: "param-added" | "param-removed" | "param-reordered" | "default-changed";
  /** The param name, or the head positional order for a reorder. */
  detail: string;
  change: string;
  /** Whether a call site can break; an unknown site always can. */
  affects: (site: CallSite | undefined) => boolean;
}

const positionalNames = (params: readonly Param[]): string[] => params.filter((p) => p.positional).map((p) => p.name);

function positionOf(params: readonly Param[], name: string): number {
  const index = positionalNames(params).indexOf(name);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

const unknowable = (site: CallSite | undefined): site is undefined => site === undefined || site.kwSplat === true || site.spreadFrom !== undefined;
const passesKeyword = (site: CallSite, name: string): boolean => site.kwargs !== undefined && Object.hasOwn(site.kwargs, name);

/** A site that passes neither a positional arg at the param's index nor a keyword of its name. */
function omits(params: readonly Param[], name: string): (site: CallSite | undefined) => boolean {
  const index = positionOf(params, name);
  return (site) => unknowable(site) || (site.args.length <= index && !passesKeyword(site, name));
}

function added(base: readonly Param[], head: readonly Param[]): ParamChange[] {
  const before = new Set(base.map((p) => p.name));
  return head
    .filter((p) => p.required && !before.has(p.name))
    .map((p) => ({ kind: "param-added", detail: p.name, change: `added required param ${p.name}`, affects: omits(head, p.name) }));
}

function removed(base: readonly Param[], head: readonly Param[]): ParamChange[] {
  const after = new Set(head.map((p) => p.name));
  const arity = positionalNames(head).length;
  return base
    .filter((p) => !after.has(p.name))
    .map((p) => ({
      kind: "param-removed",
      detail: p.name,
      change: `removed param ${p.name}`,
      affects: (site) => unknowable(site) || passesKeyword(site, p.name) || site.args.length > arity,
    }));
}

function reordered(base: readonly Param[], head: readonly Param[]): ParamChange[] {
  const before = positionalNames(base);
  const after = positionalNames(head);
  const sameSet = before.length === after.length && [...before].sort().join() === [...after].sort().join();
  if (!sameSet || before.join() === after.join()) return [];
  return [{
    kind: "param-reordered",
    detail: after.join("-"),
    change: `reordered params (${before.join(", ")}) -> (${after.join(", ")})`,
    affects: (site) => unknowable(site) || site.args.length > 1,
  }];
}

function defaults(base: readonly Param[], head: readonly Param[]): ParamChange[] {
  const before = new Map(base.map((p) => [p.name, p]));
  return head
    .filter((p) => before.has(p.name) && before.get(p.name)!.default !== p.default)
    .map((p) => ({
      kind: "default-changed",
      detail: p.name,
      change: `default of ${p.name}: ${before.get(p.name)!.default ?? "none"} -> ${p.default ?? "none"}`,
      affects: omits(head, p.name),
    }));
}

/** Signature changes a caller can feel; an added optional param and annotation-only edits are none. */
export function paramChanges(base: readonly Param[], head: readonly Param[]): ParamChange[] {
  return [...added(base, head), ...removed(base, head), ...reordered(base, head), ...defaults(base, head)];
}
