import { describe, it, expect } from "vitest";
import {
  classifyReferenceEdge,
  dominantStratum,
  resolveRelativeSpecifier,
  shareNameToken,
  splitTokens,
} from "../stratify.js";

const FILES = new Set([
  "src/a.ts",
  "src/util.ts",
  "src/nested/index.ts",
  "src/b.ts",
]);

describe("splitTokens", () => {
  it("splits camelCase and drops sub-3-char tokens", () => {
    expect([...splitTokens("computeSymbolCoupling")]).toEqual([
      "compute",
      "symbol",
      "coupling",
    ]);
    expect([...splitTokens("parseId")]).toEqual(["parse"]); // "id" dropped
  });
});

describe("shareNameToken", () => {
  it("is true when the symbol name matches its file basename token", () => {
    expect(shareNameToken("computeSymbolCoupling", "src/symbol-coupling.ts")).toBe(true);
  });
  it("is false when there is no shared token", () => {
    expect(shareNameToken("Observation", "src/types.ts")).toBe(false);
  });
});

describe("resolveRelativeSpecifier", () => {
  it("maps a TS ESM .js specifier onto the .ts source", () => {
    expect(resolveRelativeSpecifier("src/b.ts", "./a.js", FILES)).toBe("src/a.ts");
  });
  it("resolves a bare relative specifier through /index", () => {
    expect(resolveRelativeSpecifier("src/b.ts", "./nested", FILES)).toBe(
      "src/nested/index.ts",
    );
  });
  it("returns null for a bare package specifier", () => {
    expect(resolveRelativeSpecifier("src/b.ts", "@scope/pkg", FILES)).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(resolveRelativeSpecifier("src/b.ts", "./missing.js", FILES)).toBeNull();
  });
});

describe("classifyReferenceEdge", () => {
  it("labels a name-matching import semantic-findable", () => {
    // symbol `utilRun` shares token `util` with file basename `util`
    const s = classifyReferenceEdge(
      { srcId: "src/a.ts", dstId: "src/util.ts#utilRun", specifier: "./util.js" },
      FILES,
    );
    expect(s).toBe("semantic-findable");
  });

  it("labels a direct-resolving import import-chain-reachable", () => {
    const s = classifyReferenceEdge(
      { srcId: "src/b.ts", dstId: "src/a.ts#alpha", specifier: "./a.js" },
      FILES,
    );
    expect(s).toBe("import-chain-reachable");
  });

  it("labels a barrel-resolved import structurally-hidden", () => {
    // specifier points at the barrel, but the symbol's origin is util.ts
    const s = classifyReferenceEdge(
      { srcId: "src/b.ts", dstId: "src/util.ts#helper", specifier: "./nested" },
      FILES,
    );
    expect(s).toBe("structurally-hidden");
  });

  it("labels an unresolved specifier structurally-hidden", () => {
    const s = classifyReferenceEdge(
      { srcId: "src/b.ts", dstId: "src/util.ts#helper", specifier: "@scope/pkg" },
      FILES,
    );
    expect(s).toBe("structurally-hidden");
  });
});

describe("dominantStratum", () => {
  it("picks the plurality stratum", () => {
    expect(
      dominantStratum([
        "import-chain-reachable",
        "import-chain-reachable",
        "structurally-hidden",
      ]),
    ).toBe("import-chain-reachable");
  });

  it("breaks ties toward the harder stratum", () => {
    expect(
      dominantStratum(["import-chain-reachable", "structurally-hidden"]),
    ).toBe("structurally-hidden");
  });

  it("defaults an empty edge set to structurally-hidden", () => {
    expect(dominantStratum([])).toBe("structurally-hidden");
  });
});
