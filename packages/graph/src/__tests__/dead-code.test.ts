import { describe, it, expect } from "vitest";
import { parseFile, type ParsedFile } from "@codewatch/core";
import { computeDeadCodeMetrics } from "../dead-code.js";

const idOf = (p: string): string => p;
async function parseTs(code: string, fp = "f.ts"): Promise<ParsedFile> {
  return parseFile(code, fp, "typescript");
}
function unreachable(metrics: ReturnType<typeof computeDeadCodeMetrics>): number | undefined {
  return metrics.find((m) => m.name === "unreachable_statements")?.value ?? undefined;
}

describe("computeDeadCodeMetrics — unreachable statements (C-65)", () => {
  it("counts a statement after a return", async () => {
    const f = await parseTs(`function a() { return 1; const dead = 2; }`);
    expect(unreachable(computeDeadCodeMetrics([f], idOf))).toBe(1);
  });

  it("counts every statement after an unconditional throw", async () => {
    const f = await parseTs(
      `function a() { throw new Error(); const x = 1; foo(); return 2; }`,
    );
    expect(unreachable(computeDeadCodeMetrics([f], idOf))).toBe(3);
  });

  it("counts code after break/continue inside a loop block", async () => {
    const f = await parseTs(`function a() { for (;;) { break; doStuff(); } }`);
    expect(unreachable(computeDeadCodeMetrics([f], idOf))).toBe(1);
  });

  it("does not flag reachable code (no terminal)", async () => {
    const f = await parseTs(`function a() { const x = 1; return x; }`);
    expect(computeDeadCodeMetrics([f], idOf)).toEqual([]);
  });

  it("does not flag code after a CONDITIONAL return (needs a plain terminal)", async () => {
    const f = await parseTs(`function a(x: number) { if (x) return 1; return 2; }`);
    expect(computeDeadCodeMetrics([f], idOf)).toEqual([]);
  });

  it("does not flag a hoisted function declaration after a return", async () => {
    const f = await parseTs(
      `function a() { return h(); function h() { return 1; } }`,
    );
    expect(computeDeadCodeMetrics([f], idOf)).toEqual([]);
  });

  it("does not treat switch fallthrough as unreachable", async () => {
    const f = await parseTs(
      `function a(x: number) { switch (x) { case 1: return 1; case 2: return 2; } }`,
    );
    expect(computeDeadCodeMetrics([f], idOf)).toEqual([]);
  });

  it("emits sparsely — no row when a file is clean", async () => {
    const f = await parseTs(`export const x = 1;\nexport function f() { return x; }\n`);
    expect(computeDeadCodeMetrics([f], idOf)).toEqual([]);
  });

  it("skips non-TypeScript files", async () => {
    const f = await parseFile(`def a():\n    return 1\n    x = 2\n`, "f.py", "python");
    expect(computeDeadCodeMetrics([f], idOf)).toEqual([]);
  });
});
