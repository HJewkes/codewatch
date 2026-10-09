import { describe, it, expect } from "vitest";
import { CONTROL_DEFINITIONS, loadControls } from "../commands/triage-controls/controls.js";
import type { ControlDefinition } from "../commands/triage-controls/types.js";

function citationProblems(def: ControlDefinition): string[] {
  const lines = def.text.split("\n");
  const problems: string[] = [];
  for (const f of def.findings) {
    const where = `${def.id} ${f.signal} ${f.lineStart}-${f.lineEnd}`;
    if (f.lineStart < 1 || f.lineEnd < f.lineStart || f.lineEnd > lines.length) {
      problems.push(`${where}: range outside the ${lines.length}-line fixture`);
      continue;
    }
    if (!lines[f.lineStart - 1].includes(f.anchor)) problems.push(`${where}: line ${f.lineStart} lacks "${f.anchor}"`);
    const after = lines[f.lineEnd] ?? "";
    if (f.symbol && after.trim() !== "") problems.push(`${where}: symbol span stops before the end of ${f.symbol}`);
  }
  return problems;
}

function shifted(def: ControlDefinition, by: number): ControlDefinition {
  const findings = def.findings.map((f) => ({ ...f, lineStart: f.lineStart + by, lineEnd: f.lineEnd + by }));
  return { ...def, findings };
}

describe("triage control corpus", () => {
  it("loads every control under a unique id", () => {
    const controls = loadControls();

    expect(controls).toHaveLength(11);
    expect(new Set(controls.map((c) => c.id)).size).toBe(11);
  });

  it("pairs clean and slop for each code-quality kind and plants one control per change-check kind", () => {
    const labels = new Map<string, string[]>();
    for (const c of loadControls()) labels.set(c.kind, [...(labels.get(c.kind) ?? []), c.label].sort());

    for (const kind of ["single-caller-helper", "comment", "unnecessary-isinstance", "pass-through"]) expect(labels.get(kind)).toEqual(["clean", "slop"]);
    for (const kind of ["missing-test-kind", "weak-oracle", "clone"]) expect(labels.get(kind)).toHaveLength(1);
    expect(labels.size).toBe(7);
  });

  it("gives no control a spec of its own", () => {
    expect(loadControls().filter((c) => c.spec !== undefined)).toEqual([]);
  });

  it("carries the tests a missing-test-kind finding names beside its file", () => {
    const control = loadControls().find((c) => c.kind === "missing-test-kind")!;
    const named = [...control.findings[0]!.evidence!.matchAll(/([^\s,]+):\d+-\d+/g)].map((m) => m[1]);

    expect(new Set(named)).toEqual(new Set(Object.keys(control.related ?? {})));
  });

  it("expects confirmed on every slop finding and justified on every clean one", () => {
    for (const c of loadControls()) {
      expect(["clean", "slop"]).toContain(c.label);
      expect(c.findings.length).toBeGreaterThan(0);
      const expected = c.label === "slop" ? "confirmed" : "justified";
      for (const f of c.findings) expect(f).toMatchObject({ path: c.path, expected });
    }
  });

  it("cites only lines that exist in each fixture and start at the flagged code", () => {
    for (const def of CONTROL_DEFINITIONS) expect(citationProblems(def), def.id).toEqual([]);
  });

  it("rejects a control whose finding lines drift off its fixture", () => {
    for (const def of CONTROL_DEFINITIONS) {
      const lineCount = def.text.split("\n").length;

      expect(citationProblems(shifted(def, 1)), def.id).not.toEqual([]);
      expect(citationProblems(shifted(def, lineCount)), def.id).not.toEqual([]);
    }
  });

  it("keeps the label out of what the reader sees", () => {
    for (const c of loadControls()) {
      const evidence = c.findings.map((f) => f.evidence ?? "").join("\n");
      const related = Object.entries(c.related ?? {}).flat().join("\n");
      expect(`${c.path}\n${c.text}\n${related}\n${c.spec ?? ""}\n${evidence}`.toLowerCase()).not.toMatch(/\b(slop|clean|control|planted)\b/);
    }
  });
});
