import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readBlobs, treeFileIds, workspaceAt } from "../coding-git.js";
import { screenCodingCandidates } from "../coding-screen-suite.js";

/**
 * Fixture monorepo: the app test imports `run` (hop 1), which imports the
 * `@acme/lib` workspace package, whose entry is `engine` (hop 2, another
 * package). The fix changes both, and also wires `run` to `helper`, which no
 * test reaches at the parent. A doc path holds a newline.
 */

const ODD_PATH = "docs/odd\nname.md";

let repo: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8" }).trim();
}

function commit(message: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function testFile(expected: number): string {
  return `import { describe, expect, it } from "vitest";\nimport { runApp } from "../src/run";\n\ndescribe("app", () => {\n  it("works", () => {\n    expect(runApp()).toBe(${expected});\n  });\n});\n`;
}

function runFile(offset: string, helperImport = ""): string {
  return `${helperImport}import { scale } from "@acme/lib";\nexport function runApp() {\n  return scale(2)${offset};\n}\n`;
}

function helperFile(step: number): string {
  return `export function bump(n: number) {\n  return n + ${step};\n}\n`;
}

function engineFile(factor: number): string {
  return `export function scale(n: number) {\n  return n * ${factor};\n}\n`;
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "codewatch-git-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "dev"]);
  git(["config", "commit.gpgsign", "false"]);
  commit("feat: initial", {
    "package.json": '{"name":"mono","private":true}\n',
    "packages/app/package.json": '{"name":"@acme/app"}\n',
    "packages/app/src/run.ts": runFile(""),
    "packages/app/src/helper.ts": helperFile(0),
    "packages/app/test/run.test.ts": testFile(4),
    "packages/lib/package.json": '{"name":"@acme/lib","main":"dist/engine.js"}\n',
    "packages/lib/src/engine.ts": engineFile(2),
    [ODD_PATH]: "first\n",
    "docs/plain.md": "second\n",
  });
  commit("fix: scale by three", {
    "packages/app/src/run.ts": runFile(" + 1", 'import { bump } from "./helper";\n'),
    "packages/app/src/helper.ts": helperFile(1),
    "packages/app/test/run.test.ts": testFile(7),
    "packages/lib/src/engine.ts": engineFile(3),
  });
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("cross-package screen", () => {
  it("reaches the other package's entry at hop 2 and types the dark logic edit T5", () => {
    const [candidate, ...rest] = screenCodingCandidates(repo).candidates;

    expect(rest).toHaveLength(0);
    const files = candidate!.hardness.files;
    expect(Object.fromEntries(files.map((f) => [f.path, [f.light, f.hop]]))).toEqual({
      "packages/app/src/helper.ts": ["dark", null],
      "packages/app/src/run.ts": ["test-imported", 1],
      "packages/lib/src/engine.ts": ["dark", 2],
    });
    expect(candidate!.packagesSpanned).toBe(2);
    expect(candidate!.type).toBe("T5");
  });

  it("walks the parent tree, so an import edge the fix adds does not count", () => {
    const [candidate] = screenCodingCandidates(repo).candidates;

    const helper = candidate!.hardness.files.find((f) => f.path === "packages/app/src/helper.ts");
    expect(helper?.hop).toBeNull();
  });

  it("reads workspace packages from the commit's manifests", () => {
    expect([...workspaceAt(repo, "HEAD~1").keys()].sort()).toEqual(["@acme/app", "@acme/lib", "mono"]);
  });
});

describe("paths holding a newline", () => {
  it("lists the path unquoted and keeps later blobs aligned", () => {
    expect(treeFileIds(repo, "HEAD").has(ODD_PATH)).toBe(true);

    const blobs = readBlobs(repo, "HEAD", [ODD_PATH, "docs/missing.md", "docs/plain.md"]);

    expect(Object.fromEntries(blobs)).toEqual({ [ODD_PATH]: "first\n", "docs/plain.md": "second\n" });
  });
});
