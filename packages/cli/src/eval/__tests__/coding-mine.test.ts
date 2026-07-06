import { describe, it, expect } from "vitest";
import {
  classifyEditFiles,
  extractRelativeSpecifiers,
  isSourceFile,
  isTestFile,
  parseNameStatus,
  parseNumstat,
  partitionChangedFiles,
  passesScope,
  shouldRejectByMessage,
} from "../coding-mine.js";
import type { FileChange } from "../coding-types.js";

const change = (
  path: string,
  status: FileChange["status"],
  added = 1,
  deleted = 0,
): FileChange => ({ path, status, added, deleted });

describe("shouldRejectByMessage", () => {
  it("rejects non-behavioral commit subjects", () => {
    for (const s of [
      "Revert \"add prefix\"",
      "Merge branch 'main'",
      "chore: bump deps",
      "docs: update README",
      "ci: pin node 24",
      "release v1.2.3",
      "v10.33.1",
      "refactor: extract helper",
    ]) {
      expect(shouldRejectByMessage(s)).toBe(true);
    }
  });
  it("keeps behavioral fix/feat subjects", () => {
    expect(shouldRejectByMessage("fix(react-query): add prefix support")).toBe(false);
    expect(shouldRejectByMessage("feat(openapi): add server url support")).toBe(false);
  });
});

describe("isTestFile / isSourceFile", () => {
  it("recognizes test files by suffix and directory", () => {
    expect(isTestFile("src/a.test.ts")).toBe(true);
    expect(isTestFile("src/a.spec.tsx")).toBe(true);
    expect(isTestFile("packages/x/__tests__/a.ts")).toBe(true);
    expect(isTestFile("src/a.ts")).toBe(false);
  });
  it("recognizes non-test source, excluding declarations and tests", () => {
    expect(isSourceFile("src/a.ts")).toBe(true);
    expect(isSourceFile("src/a.test.ts")).toBe(false);
    expect(isSourceFile("src/a.d.ts")).toBe(false);
    expect(isSourceFile("README.md")).toBe(false);
  });
});

describe("partitionChangedFiles", () => {
  it("buckets tests, sources, and everything else; deletions are 'other'", () => {
    const part = partitionChangedFiles([
      change("src/a.ts", "modified"),
      change("src/a.test.ts", "added"),
      change("README.md", "modified"),
      change("src/old.ts", "deleted"),
    ]);
    expect(part.sourceFiles).toEqual(["src/a.ts"]);
    expect(part.testFiles).toEqual(["src/a.test.ts"]);
    expect(part.otherFiles).toEqual(["README.md", "src/old.ts"]);
  });
});

describe("passesScope", () => {
  const opts = { maxSourceFiles: 3, maxChangedLoc: 80 };
  it("requires at least one test and one source file", () => {
    const changes = [change("src/a.ts", "modified", 5, 2)];
    expect(passesScope(partitionChangedFiles(changes), changes, opts)).toBe(false);
  });
  it("admits a small single-purpose test-carrying change", () => {
    const changes = [
      change("src/a.ts", "modified", 30, 5),
      change("src/a.test.ts", "added", 20, 0),
    ];
    expect(passesScope(partitionChangedFiles(changes), changes, opts)).toBe(true);
  });
  it("rejects on too much churn (counting non-source files too)", () => {
    const changes = [
      change("src/a.ts", "modified", 10, 0),
      change("src/a.test.ts", "added", 5, 0),
      change("snapshot.json", "modified", 900, 0),
    ];
    expect(passesScope(partitionChangedFiles(changes), changes, opts)).toBe(false);
  });
  it("rejects on too many source files", () => {
    const changes = [
      change("src/a.ts", "modified"),
      change("src/b.ts", "modified"),
      change("src/c.ts", "modified"),
      change("src/d.ts", "modified"),
      change("src/a.test.ts", "added"),
    ];
    expect(passesScope(partitionChangedFiles(changes), changes, opts)).toBe(false);
  });
});

describe("parseNameStatus", () => {
  it("parses status codes and takes the new path for renames", () => {
    const text = [
      "M\tsrc/a.ts",
      "A\tsrc/a.test.ts",
      "D\tsrc/old.ts",
      "R096\tsrc/old-name.ts\tsrc/new-name.ts",
    ].join("\n");
    expect(parseNameStatus(text)).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/a.test.ts", status: "added" },
      { path: "src/old.ts", status: "deleted" },
      { path: "src/new-name.ts", status: "renamed" },
    ]);
  });
});

describe("parseNumstat", () => {
  it("reads churn and resolves rename notation to the new path", () => {
    const map = parseNumstat(
      ["3\t1\tsrc/a.ts", "-\t-\timg.png", "5\t2\tpkg/{old => new}/f.ts"].join("\n"),
    );
    expect(map.get("src/a.ts")).toEqual({ added: 3, deleted: 1 });
    expect(map.get("img.png")).toEqual({ added: null, deleted: null });
    expect(map.get("pkg/new/f.ts")).toEqual({ added: 5, deleted: 2 });
  });
});

describe("extractRelativeSpecifiers", () => {
  it("collects only relative import/require/dynamic-import specifiers", () => {
    const src = [
      "import { a } from './a.js';",
      "import '../b';",
      "const c = require('./c');",
      "await import('./d.js');",
      "import x from 'react';",
    ].join("\n");
    expect(extractRelativeSpecifiers(src).sort()).toEqual([
      "../b",
      "./a.js",
      "./c",
      "./d.js",
    ]);
  });
});

describe("classifyEditFiles", () => {
  const files = new Set([
    "src/foo.ts",
    "src/deep/impl.ts",
    "src/internal/core.ts",
    "src/index.ts",
  ]);
  it("is semantic-findable when a test basename shares the edit file's name", () => {
    expect(
      classifyEditFiles(["src/foo.ts"], ["src/foo.test.ts"], new Map(), files),
    ).toBe("semantic-findable");
  });
  it("is import-chain-reachable when a test imports the edit file directly", () => {
    const sources = new Map([["test/a.test.ts", "import {x} from '../src/deep/impl.js'"]]);
    expect(
      classifyEditFiles(["src/deep/impl.ts"], ["test/a.test.ts"], sources, files),
    ).toBe("import-chain-reachable");
  });
  it("is structurally-hidden when only a barrel is imported", () => {
    const sources = new Map([["test/a.test.ts", "import {x} from '../src/index.js'"]]);
    expect(
      classifyEditFiles(["src/internal/core.ts"], ["test/a.test.ts"], sources, files),
    ).toBe("structurally-hidden");
  });
});
