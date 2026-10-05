import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { screenCodingCandidates } from "../coding-screen-suite.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

/**
 * Fixture history: the test imports `api`, which imports `wiring` (hop 2);
 * `orphan` is not reached. Five more files share the keywords so they are not
 * distinctive. Three fix commits: dark logic, a dark export-only edit, and a
 * lit-only edit.
 */
const BASE: Record<string, string> = {
  "test/api.test.ts": testFile(3),
  "src/api.ts": 'import { wire } from "./wiring";\nexport function apiValue() {\n  return wire(1);\n}\n',
  "src/wiring.ts":
    'import { base } from "./shared";\nexport function wire(n: number) {\n  return base(n) + 2;\n}\nfunction helperAlpha() {\n  return 2;\n}\n',
  "src/shared.ts": 'import { noop } from "./util";\nexport function base(n: number) {\n  return noop() + n;\n}\n',
  "src/util.ts": 'import { join } from "node:path";\nexport function noop() {\n  return join("a").length;\n}\n',
  "src/orphan.ts": 'import { noop } from "./util";\nexport function orphanCalc() {\n  return noop();\n}\n',
  "src/extra.ts": 'import { noop } from "./util";\nexport function extraThing() {\n  return noop();\n}\n',
};

function testFile(expected: number): string {
  return `import { describe, expect, it } from "vitest";\nimport { apiValue } from "../src/api";\n\ndescribe("api", () => {\n  it("works", () => {\n    expect(apiValue()).toBe(${expected});\n  });\n});\n`;
}

let repo: string;

function git(args: string[]): void {
  childProcess.execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function commit(message: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
}

function replaceIn(path: string, from: string, to: string): Record<string, string> {
  BASE[path] = BASE[path]!.replace(from, to);
  return { [path]: BASE[path]! };
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "codewatch-screen-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "dev"]);
  git(["config", "commit.gpgsign", "false"]);
  commit("feat: initial", BASE);
  commit("fix: deep wiring", {
    "test/api.test.ts": testFile(5),
    ...replaceIn("src/api.ts", "wire(1)", "wire(2)"),
    ...replaceIn("src/wiring.ts", "base(n) + 2", "base(n) + 3"),
    ...replaceIn("src/orphan.ts", "return noop();", "return noop() * 2;"),
  });
  commit("fix: export helper", {
    "test/api.test.ts": testFile(6),
    ...replaceIn("src/api.ts", "wire(2)", "wire(3)"),
    ...replaceIn("src/wiring.ts", "function helperAlpha", "export function helperAlpha"),
  });
  commit("fix: api only", {
    "test/api.test.ts": testFile(7),
    ...replaceIn("src/api.ts", "wire(3)", "wire(4)"),
  });
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("screenCodingCandidates", () => {
  it("reports hop depth per edit file", () => {
    const screen = screenCodingCandidates(repo, { minDark: 1 });

    expect(screen.candidates).toHaveLength(1);
    const files = screen.candidates[0]!.hardness.files;
    expect(Object.fromEntries(files.map((f) => [f.path, f.hop]))).toEqual({
      "src/api.ts": 1,
      "src/wiring.ts": 2,
      "src/orphan.ts": null,
    });
  });

  it("records hardness features and tallies the dark and trivial rejections", () => {
    const screen = screenCodingCandidates(repo, { minDark: 1 });

    expect(screen.candidates[0]!.hardness).toMatchObject({
      darkFiles: 2,
      trivialDarkFiles: 0,
      darkReachable: 1,
      maxHop: 2,
    });
    expect(screen.funnel).toMatchObject({
      mined: 4,
      scopeRejected: 1,
      darkRejected: 1,
      trivialRejected: 1,
      gateRun: 0,
    });
    expect(screen.params.minDark).toBe(1);
  });

  it("keeps every scoped commit at the default minDark of 0", () => {
    const screen = screenCodingCandidates(repo);

    expect(screen.candidates).toHaveLength(3);
    expect(screen.funnel).toMatchObject({ darkRejected: 0, trivialRejected: 0 });
  });

  it("runs only git: no install and no test command", () => {
    const spawn = vi.mocked(childProcess.execFileSync);
    spawn.mockClear();

    screenCodingCandidates(repo, { minDark: 1 });

    const commands = new Set(spawn.mock.calls.map(([cmd]) => cmd));
    expect(spawn).toHaveBeenCalled();
    expect([...commands]).toEqual(["git"]);
  });
});
