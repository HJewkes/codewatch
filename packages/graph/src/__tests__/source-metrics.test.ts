import { describe, it, expect } from "vitest";
import { parseFile, type ParsedFile } from "@codewatch/core";
import { computeSourceMetrics } from "../source-metrics.js";

const idOf = (p: string): string => p;

async function parseTs(code: string, filePath = "f.ts"): Promise<ParsedFile> {
  return parseFile(code, filePath, "typescript");
}

async function parsePy(code: string, filePath = "f.py"): Promise<ParsedFile> {
  return parseFile(code, filePath, "python");
}

function metric(
  metrics: ReturnType<typeof computeSourceMetrics>,
  nodeId: string,
  name: string,
): number | null | undefined {
  return metrics.find((m) => m.nodeId === nodeId && m.name === name)?.value;
}

describe("computeSourceMetrics — loc", () => {
  it("counts non-empty lines as loc", async () => {
    const file = await parseTs("const a = 1;\n\n  \nconst b = 2;\n");
    const metrics = computeSourceMetrics([file], idOf);
    expect(metric(metrics, "f.ts", "loc")).toBe(2);
  });

  it("includes loc on a file with no functions", async () => {
    const file = await parseTs("export const x = 42;\n");
    const metrics = computeSourceMetrics([file], idOf);
    expect(metric(metrics, "f.ts", "loc")).toBe(1);
    expect(metric(metrics, "f.ts", "function_count")).toBe(0);
    expect(metric(metrics, "f.ts", "cyclomatic_max")).toBeUndefined();
  });
});

describe("computeSourceMetrics — function_count", () => {
  it("counts function declarations and method definitions", async () => {
    const file = await parseTs(
      "function a() {}\nfunction b() {}\nclass C { m() {} }\n",
    );
    expect(metric(computeSourceMetrics([file], idOf), "f.ts", "function_count")).toBe(3);
  });

  it("counts python def statements", async () => {
    const file = await parsePy("def a():\n    pass\ndef b():\n    pass\n");
    expect(metric(computeSourceMetrics([file], idOf), "f.py", "function_count")).toBe(2);
  });
});

describe("computeSourceMetrics — cyclomatic", () => {
  it("returns base complexity 1 for a function with no branches", async () => {
    const file = await parseTs("function a() { return 1; }\n");
    const metrics = computeSourceMetrics([file], idOf);
    expect(metric(metrics, "f.ts", "cyclomatic_max")).toBe(1);
    expect(metric(metrics, "f.ts", "cyclomatic_sum")).toBe(1);
  });

  it("counts if + else-if + ternary + && as separate branches", async () => {
    const file = await parseTs(
      `function a(x: number) {
        if (x > 0) {
          if (x > 10 && x < 20) return 1;
        } else if (x < 0) {
          return -1;
        }
        return x > 5 ? "big" : "small";
      }\n`,
    );
    const metrics = computeSourceMetrics([file], idOf);
    // 1 base + if + nested if + && + (else-if = if) + ternary = 6
    expect(metric(metrics, "f.ts", "cyclomatic_max")).toBe(6);
  });

  it("aggregates max vs. sum across functions", async () => {
    const file = await parseTs(
      `function simple() { return 1; }
       function branchy(x: number) {
         if (x > 0) return 1;
         if (x < 0) return -1;
         return 0;
       }\n`,
    );
    const metrics = computeSourceMetrics([file], idOf);
    expect(metric(metrics, "f.ts", "cyclomatic_max")).toBe(3);
    expect(metric(metrics, "f.ts", "cyclomatic_sum")).toBe(4);
  });
});

describe("computeSourceMetrics — max_nesting_depth", () => {
  it("measures the deepest nesting across all functions in the file", async () => {
    const file = await parseTs(
      `function flat() { return 1; }
       function deep() {
         if (true) {
           for (let i = 0; i < 10; i++) {
             while (i > 0) {
               i--;
             }
           }
         }
       }\n`,
    );
    expect(
      metric(computeSourceMetrics([file], idOf), "f.ts", "max_nesting_depth"),
    ).toBe(3);
  });
});

describe("computeSourceMetrics — id mapping", () => {
  it("uses the supplied fileIdOf to key the metrics", async () => {
    const file = await parseTs("export const x = 1;\n", "/abs/path/foo.ts");
    const metrics = computeSourceMetrics([file], (p) =>
      p.replace("/abs/path/", "rel/"),
    );
    const ids = new Set(metrics.map((m) => m.nodeId));
    expect(ids).toEqual(new Set(["rel/foo.ts"]));
  });
});
