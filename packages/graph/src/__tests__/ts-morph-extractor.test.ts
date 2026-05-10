import { describe, it, expect, beforeAll } from "vitest";
import {
  Project,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from "ts-morph";
import { parseFile, type ParsedFile } from "@code-style/core";
import { TsMorphGraphExtractor } from "../extractors/ts-morph-extractor.js";
import type { GraphFragment } from "../types.js";

const REPO_ROOT = "/repo";

const FILES: Record<string, string> = {
  "/repo/src/a.ts": `export const A = 1;\n`,
  "/repo/src/b.ts":
    `import { A } from "./a.js";\nexport const B = A + 1;\n`,
  "/repo/src/index.ts":
    `import { A } from "./a.js";\n` +
    `import { B } from "./b.js";\n` +
    `import { readFile } from "node:fs/promises";\n` +
    `import * as ts from "typescript";\n` +
    `export * from "./a.js";\n` +
    `export const x = A + B + (readFile ? 0 : 1) + (ts ? 0 : 1);\n`,
  "/repo/src/only-external.ts":
    `import { join } from "node:path";\n` +
    `import sub from "@scope/pkg/sub";\n` +
    `export const y = join("a", "b") + sub;\n`,
};

interface Fixture {
  project: Project;
  parsed: Record<string, ParsedFile>;
  extract: (filePath: string) => GraphFragment[];
}

let fixture: Fixture;

beforeAll(async () => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.NodeNext,
    },
  });
  for (const [filePath, content] of Object.entries(FILES)) {
    project.createSourceFile(filePath, content, { overwrite: true });
  }

  const parsed: Record<string, ParsedFile> = {};
  for (const [filePath, content] of Object.entries(FILES)) {
    parsed[filePath] = await parseFile(content, filePath, "typescript");
  }

  const extractor = new TsMorphGraphExtractor({
    repoRoot: REPO_ROOT,
    project,
  });

  fixture = {
    project,
    parsed,
    extract: (filePath: string) => extractor.extract(parsed[filePath]!),
  };
});

describe("TsMorphGraphExtractor", () => {
  it("returns one fragment per TS file", () => {
    const fragments = fixture.extract("/repo/src/index.ts");
    expect(fragments).toHaveLength(1);
  });

  it("returns an empty array for non-TS files", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const extractor = new TsMorphGraphExtractor({
      repoRoot: REPO_ROOT,
      project,
    });
    const fakePython = await parseFile(
      "x = 1\n",
      "/repo/script.py",
      "python",
    );
    expect(extractor.extract(fakePython)).toEqual([]);
  });

  it("emits a file node with the relative path id", () => {
    const [fragment] = fixture.extract("/repo/src/index.ts");
    const fileNode = fragment!.nodes.find((n) => n.kind === "file");
    expect(fileNode).toBeDefined();
    expect(fileNode!.id).toBe("src/index.ts");
    expect(fileNode!.parentId).toBe("src/index");
    expect(fileNode!.language).toBe("typescript");
  });

  it("emits a module node with the extension stripped", () => {
    const [fragment] = fixture.extract("/repo/src/index.ts");
    const moduleNode = fragment!.nodes.find((n) => n.kind === "module");
    expect(moduleNode).toBeDefined();
    expect(moduleNode!.id).toBe("src/index");
    expect(moduleNode!.parentId).toBe("src");
  });

  it("emits internal imports as edges to file ids", () => {
    const [fragment] = fixture.extract("/repo/src/index.ts");
    const imports = fragment!.edges.filter((e) => e.kind === "imports");
    const internalDsts = imports
      .map((e) => e.dstId)
      .filter((id) => !id.startsWith("npm:") && !id.startsWith("node:"));
    expect(internalDsts.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("emits node: external nodes verbatim", () => {
    const [fragment] = fixture.extract("/repo/src/index.ts");
    const ext = fragment!.nodes.find(
      (n) => n.kind === "external" && n.id === "node:fs/promises",
    );
    expect(ext).toBeDefined();
    const edge = fragment!.edges.find(
      (e) => e.kind === "imports" && e.dstId === "node:fs/promises",
    );
    expect(edge).toBeDefined();
    expect(edge!.attrs).toEqual({ specifier: "node:fs/promises" });
  });

  it("emits npm: external nodes for bare npm packages", () => {
    const [fragment] = fixture.extract("/repo/src/index.ts");
    const ext = fragment!.nodes.find(
      (n) => n.kind === "external" && n.id === "npm:typescript",
    );
    expect(ext).toBeDefined();
  });

  it("strips subpaths from scoped npm specifiers", () => {
    const [fragment] = fixture.extract("/repo/src/only-external.ts");
    const ids = fragment!.nodes
      .filter((n) => n.kind === "external")
      .map((n) => n.id)
      .sort();
    expect(ids).toEqual(["node:path", "npm:@scope/pkg"]);
  });

  it("emits re-export edges with the re-exports kind", () => {
    const [fragment] = fixture.extract("/repo/src/index.ts");
    const reExports = fragment!.edges.filter((e) => e.kind === "re-exports");
    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.srcId).toBe("src/index.ts");
    expect(reExports[0]!.dstId).toBe("src/a.ts");
  });
});
