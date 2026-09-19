import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// End to end through the built CLI: codewatch has no JavaScript grammar, so .js and .jsx files are skipped or rejected.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const PROFILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/diagnostic/fixtures/test-profile.json",
);

const FILES: Record<string, string> = {
  "src/add.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  "src/twice.js": "export function twice(x) {\n  return x * 2;\n}\n",
  "src/Badge.jsx": "export function Badge({ label }) {\n  return <span>{label}</span>;\n}\n",
  "README.md": "# fixture\n",
};

function runCli(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf-8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("a repo with .js and .jsx files next to TypeScript", () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(tmpdir(), "codewatch-js-files-"));
    for (const [rel, content] of Object.entries(FILES)) {
      await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
      await fs.writeFile(path.join(repo, rel), content);
    }
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "empty");
    git("add", "-A");
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("diff checks the staged TypeScript file and names the skipped .js and .jsx files on stderr", () => {
    const { status, stdout, stderr } = runCli(["diff", "--profile", PROFILE], repo);

    expect(stderr.trim()).toBe("Skipped 2 file(s) with no parser: src/Badge.jsx, src/twice.js");
    expect(stdout).toContain("src/add.ts:1 ERROR");
    expect(stdout).not.toMatch(/twice\.js|Badge\.jsx|README/);
    expect(stdout).toMatch(/deviation\(s\) in \d+ observations\./);
    expect(status).toBe(1);
  });

  it("analyze counts only the TypeScript file", () => {
    const { status, stdout } = runCli(["analyze", repo, "--json"], repo);

    expect(status).toBe(0);
    expect(JSON.parse(stdout).files).toEqual({ total: 1, byLanguage: { typescript: 1 } });
  });

  it("analyze --lang javascript is rejected with the supported languages", () => {
    const { status, stdout, stderr } = runCli(["analyze", repo, "--json", "--lang", "javascript"], repo);

    expect(status).toBe(1);
    expect(stderr).toContain("Unsupported language: javascript (supported: typescript, python)");
    expect(stdout).toBe("");
  });

  it("graph index indexes the TypeScript file and no .js or .jsx file", async () => {
    const db = path.join(repo, "graph.db");
    const { status, stdout } = runCli(["graph", "index", ".", "--db", db, "--json", "--no-churn"], repo);

    expect(status).toBe(0);
    expect(JSON.parse(stdout).files).toBe(1);
  });
});
