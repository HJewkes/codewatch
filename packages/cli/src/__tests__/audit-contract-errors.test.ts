import { describe, it, expect } from "vitest";
import { parseFile } from "@titan-design/code-parser";
import { lostErrors, type OwnerOf } from "../commands/audit-contract-errors.js";

/** Each def owns the lines up to the next one. */
function ownersOf(text: string): OwnerOf {
  const defs = text.split("\n").flatMap((line, i) => (line.startsWith("def ") ? [{ name: line.slice(4, line.indexOf("(")), line: i + 1 }] : []));
  return (file, line) => {
    const owner = defs.filter((d) => d.line <= line).at(-1);
    return owner ? `${file}#${owner.name}` : undefined;
  };
}

async function lost(baseText: string, headText: string) {
  const [base, head] = [await parseFile(baseText, "m.py", "python"), await parseFile(headText, "m.py", "python")];
  return lostErrors(new Map([["m.py", base]]), new Map([["m.py", head]]), ownersOf(baseText), ownersOf(headText));
}

describe("lost error sites", () => {
  it("reports nothing when a guard leaves one symbol and lands in two new helpers", async () => {
    const base = 'def a(x):\n    if x:\n        raise E("x")\n';
    const head = 'def a(x):\n    b(x)\n\n\ndef b(x):\n    if x:\n        raise E("x")\n\n\ndef c(x):\n    if x:\n        raise E("x")\n';
    expect(await lost(base, head)).toEqual([]);
  });

  it("attributes a dropped site to the symbol that held it", async () => {
    const base = 'def a(x):\n    if x:\n        raise E("x")\n';
    const head = "def a(x):\n    return x\n";
    expect((await lost(base, head)).map((l) => [l.ownerId, l.sites.map((s) => s.line)])).toEqual([["m.py#a", [3]]]);
  });
});
