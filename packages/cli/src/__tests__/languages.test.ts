import { describe, it, expect } from "vitest";
import { shouldIncludeFile } from "@titan-design/code-parser";
import { DEFAULT_LANGUAGES, resolveLanguages } from "../utils/languages.js";

describe("resolveLanguages", () => {
  it("defaults to typescript when no languages are given", () => {
    expect(resolveLanguages(undefined)).toEqual(["typescript"]);
    expect(resolveLanguages([])).toEqual(["typescript"]);
  });

  it("maps aliases onto filter keys and removes duplicates", () => {
    expect(resolveLanguages(["ts", "tsx", "py", "Python"])).toEqual([
      "typescript",
      "python",
    ]);
  });

  it("rejects an unknown language with a message naming the accepted values", () => {
    expect(() => resolveLanguages(["js"])).toThrow(/Unknown language "js"/);
    expect(() => resolveLanguages(["js"])).toThrow(/typescript/);
  });
});

describe("default languages against the parser's file filter", () => {
  it("admit TypeScript files, unlike the old short-code defaults", () => {
    expect(shouldIncludeFile("src/index.ts", DEFAULT_LANGUAGES)).toBe(true);
    expect(shouldIncludeFile("src/index.ts", ["ts", "js"])).toBe(false);
  });
});
