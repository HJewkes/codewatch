import { parseSymbolId, type Finding, type GraphNode } from "@titan-design/code-graph";
import { lineAttr } from "./audit-collect.js";
import type { EntryPoint } from "./audit-entries.js";
import type { CallArgs, FeedFacts, FlagFact, KeyRead, ParamFacts, ReaderFacts, ValueClass } from "./audit-input-facts.js";
import { testsLine } from "./audit-test-kinds.js";

export type ClassName = "empty" | "key" | "mode" | "mode-error" | "unasserted" | "null";

export interface InputClass {
  class: ClassName;
  subject: string;
  readAt?: string;
  fed: Record<string, number>;
  never: string[];
  /** Not written to the JSON: the reader named in the evidence, how it reads the key, and the tests counted. */
  readBy?: string;
  keyRead?: KeyRead;
  tests: string[];
}

export interface EntryCensus {
  id: string;
  kind: EntryPoint["kind"];
  tests: string[];
  classes: InputClass[];
}

export interface InputClassCensus {
  entries: EntryCensus[];
  notes: string[];
}

/** One entry's facts, gathered once and read by every class. */
export interface EntryFacts {
  entry: EntryPoint;
  name: string;
  readers: { id: string; name: string; readAt: string; facts: ReaderFacts }[];
  flags: FlagFact[];
  params: ParamFacts | undefined;
  feeds: Map<string, FeedFacts>;
  calls: CallArgs[];
}

/** Findings per entry; the census keeps every class, so the cap only ranks. */
const FINDINGS_PER_ENTRY = 5;
const FALSY = /^(?:False|None|0|0\.0|)$/;
const KEY_CLASSES = ["missing", "null", "empty"] as const;

const never = (fed: Record<string, number>, names: readonly string[]): string[] => names.filter((n) => fed[n] === 0);

function keyClasses(facts: EntryFacts): InputClass[] {
  const out: InputClass[] = [];
  const claimed = new Set<string>();
  for (const reader of facts.readers) {
    const keys = reader.facts.keys;
    if (keys.size < 2) continue;
    const matched = [...facts.feeds].flatMap(([test, feed]) =>
      feed.documents.filter((d) => [...d.keys()].filter((k) => keys.has(k)).length >= 2).map((doc) => ({ test, doc })),
    );
    if (matched.length === 0) continue;
    for (const [key, read] of keys) {
      if (read === "required" || claimed.has(key)) continue;
      claimed.add(key);
      const fed = { present: 0, null: 0, missing: 0, empty: 0 };
      for (const { doc } of matched) fed[doc.get(key) ?? "missing"] += 1;
      const tests = [...new Set(matched.map((m) => m.test))];
      out.push({ class: "key", subject: key, readAt: reader.readAt, readBy: reader.name, keyRead: read, fed, never: never(fed, KEY_CLASSES), tests });
    }
  }
  return out;
}

const argAt = (call: CallArgs, names: readonly string[], param: string): ValueClass | undefined =>
  call.keywords.get(param) ?? call.positional[names.indexOf(param)];

function emptyClasses(facts: EntryFacts): InputClass[] {
  const tests = [...facts.feeds.keys()];
  if (!facts.params) {
    const fed = { empty: [...facts.feeds.values()].filter((f) => f.empty).length };
    return [{ class: "empty", subject: "input", fed, never: never(fed, ["empty"]), tests }];
  }
  const { names, iterated } = facts.params;
  return iterated.map((param) => {
    const fed = { empty: facts.calls.filter((c) => argAt(c, names, param) === "empty").length };
    return { class: "empty", subject: param, fed, never: never(fed, ["empty"]), tests };
  });
}

function nullClasses(facts: EntryFacts): InputClass[] {
  if (!facts.params) return [];
  const { names, nullable } = facts.params;
  const tests = [...facts.feeds.keys()];
  return nullable.map((param) => {
    const fed = {
      null: facts.calls.filter((c) => argAt(c, names, param) === "null").length,
      omitted: facts.calls.filter((c) => argAt(c, names, param) === undefined).length,
    };
    return { class: "null", subject: param, fed, never: fed.null + fed.omitted === 0 ? ["null"] : [], tests };
  });
}

const flagKwarg = (flag: FlagFact, feed: FeedFacts): string | undefined => feed.kwargs.get(flag.name.replaceAll("-", "_"));

function passesFlag(flag: FlagFact, feed: FeedFacts): boolean {
  return flagKwarg(flag, feed) !== undefined || [...feed.literals].some((l) => l === `--${flag.name}` || l.startsWith(`--${flag.name}=`));
}

function flagOn(flag: FlagFact, feed: FeedFacts): boolean {
  const kwarg = flagKwarg(flag, feed);
  return kwarg === undefined ? passesFlag(flag, feed) : !FALSY.test(kwarg);
}

function passesChoice(flag: FlagFact, value: string, feed: FeedFacts): boolean {
  return flagKwarg(flag, feed) === value || feed.literals.has(`--${flag.name}=${value}`) || (feed.literals.has(`--${flag.name}`) && feed.literals.has(value));
}

function modeClasses(facts: EntryFacts): InputClass[] {
  const feeds = [...facts.feeds];
  if (!feeds.some(([, f]) => facts.flags.some((flag) => passesFlag(flag, f)))) return [];
  const tests = feeds.map(([t]) => t);
  return facts.flags.flatMap((flag): InputClass[] => {
    if (flag.boolean) {
      const on = feeds.filter(([, f]) => flagOn(flag, f)).length;
      const fed = { on, off: feeds.length - on };
      return [{ class: "mode", subject: flag.name, fed, never: never(fed, ["on", "off"]), tests }];
    }
    return flag.choices.map((value) => {
      const fed = { passed: feeds.filter(([, f]) => passesChoice(flag, value, f)).length };
      return { class: "mode", subject: `${flag.name}=${value}`, fed, never: never(fed, ["passed"]), tests };
    });
  });
}

function modeErrorClasses(facts: EntryFacts): InputClass[] {
  const feeds = [...facts.feeds];
  const codes = [...new Set(feeds.flatMap(([, f]) => [...f.asserted]))].sort();
  return codes.flatMap((code) =>
    facts.flags.filter((flag) => flag.boolean).map((flag): InputClass => {
      const asserting = feeds.filter(([, f]) => f.asserted.has(code));
      const on = asserting.filter(([, f]) => flagOn(flag, f)).length;
      const fed = { on, off: asserting.length - on };
      return { class: "mode-error", subject: `${code}@${flag.name}`, fed, never: on > 0 && fed.off === 0 ? ["off"] : [], tests: asserting.map(([t]) => t) };
    }),
  );
}

function unassertedClasses(facts: EntryFacts): InputClass[] {
  const codes = [...new Set(facts.readers.flatMap((r) => [...r.facts.codes]))].sort();
  return codes.map((code) => {
    const asserting = [...facts.feeds].filter(([, f]) => f.asserted.has(code)).map(([t]) => t);
    const fed = { asserted: asserting.length };
    return { class: "unasserted", subject: code, fed, never: never(fed, ["asserted"]), tests: asserting };
  });
}

/** Every input class of one entry, gap or not. */
export function classifyGaps(facts: EntryFacts): InputClass[] {
  const classes = [modeErrorClasses, keyClasses, emptyClasses, modeClasses, nullClasses, unassertedClasses].flatMap((f) => f(facts));
  return classes.filter((c) => c.class !== "mode-error" || c.fed.on! + c.fed.off! > 0);
}

function rankOf(c: InputClass): number {
  if (c.class === "key") return c.keyRead === "default" ? 1 : 2;
  return { "mode-error": 0, empty: 3, mode: 4, null: 5, unasserted: 6 }[c.class];
}

function evidenceOf(entry: { name: string; kind: string }, c: InputClass, nodes: ReadonlyMap<string, GraphNode>): string {
  const subject = c.class === "key" ? `key ${c.subject}, read by ${c.readBy} at ${c.readAt}` : `${c.class} ${c.subject}`;
  return [
    `entry: ${entry.name} (${entry.kind})`,
    `class: ${subject}`,
    `fed: ${Object.entries(c.fed).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `never: ${c.never.join(", ")}`,
    testsLine(c.tests, nodes),
  ].join("\n");
}

/** One `entry-input-class` finding per class no test feeds, ranked, at most five per entry, filed on the entry. */
export function inputClassFindings(census: InputClassCensus, nodes: ReadonlyMap<string, GraphNode>): Finding[] {
  return census.entries.flatMap((entry) => {
    const node = nodes.get(entry.id);
    const parsed = parseSymbolId(entry.id);
    if (!node || !parsed) return [];
    const start = lineAttr(node, "startLine");
    const end = lineAttr(node, "endLine");
    const gaps = entry.classes.filter((c) => c.never.length > 0).sort((a, b) => rankOf(a) - rankOf(b) || a.subject.localeCompare(b.subject));
    return gaps.slice(0, FINDINGS_PER_ENTRY).map((c) => ({
      id: `codewatch:entry-input-class:${entry.id}:${c.class}:${c.subject}`,
      path: parsed.fileId,
      ...(start !== undefined && end !== undefined ? { lineStart: start, lineEnd: end } : {}),
      symbol: parsed.name,
      signal: "entry-input-class",
      severity: "warning" as const,
      evidence: evidenceOf({ name: parsed.name, kind: entry.kind }, c, nodes),
      tool: "codewatch",
    }));
  });
}
