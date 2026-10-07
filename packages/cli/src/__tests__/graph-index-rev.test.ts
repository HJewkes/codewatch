import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openCodeGraph } from "@titan-design/code-graph";

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const SOURCE = path.join("pkg", "src", "a.ts");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI_ENTRY, "graph", "index", ...args], { cwd, encoding: "utf8" });
}

async function commitSource(repo: string, body: string, message: string): Promise<void> {
  await fs.writeFile(path.join(repo, SOURCE), body);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
}

function snapshotOf(repo: string, snapshotId: number): { ref: string; symbols: string[] } {
  const store = openCodeGraph(path.join(repo, ".codewatch", "graph.db"));
  try {
    const symbols = store
      .listNodes(snapshotId, { includeSymbols: true })
      .filter((n) => n.kind === "symbol")
      .map((n) => n.id);
    return { ref: store.getSnapshot(snapshotId)!.ref, symbols };
  } finally {
    store.close();
  }
}

describe("graph index --rev on a repo whose working tree differs", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "codewatch-index-rev-")));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "fixture@example.com"]);
    git(repo, ["config", "user.name", "fixture"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    await fs.mkdir(path.join(repo, "pkg", "src"), { recursive: true });
    await commitSource(repo, "export function alpha(): number {\n  return 1;\n}\n", "add alpha");
    await commitSource(repo, "export function beta(): number {\n  return 2;\n}\n", "rename to beta");
    await fs.writeFile(path.join(repo, SOURCE), "export function gamma(): number {\n  return 3;\n}\n");
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("indexes HEAD~1's symbols, rooted at the repo root, labelled with the rev", () => {
    const run = runCli(repo, ["pkg", "--rev", "HEAD~1", "--json"]);

    expect(run.status, run.stderr).toBe(0);
    const { ref, symbols } = snapshotOf(repo, JSON.parse(run.stdout).snapshotId);
    expect(symbols).toEqual(["pkg/src/a.ts#alpha"]);
    expect(ref).toBe("HEAD~1");
  });

  it("keeps an explicit --ref as the snapshot label", () => {
    const run = runCli(repo, ["pkg", "--rev", "HEAD~1", "--ref", "baseline", "--json"]);

    expect(run.status, run.stderr).toBe(0);
    expect(snapshotOf(repo, JSON.parse(run.stdout).snapshotId).ref).toBe("baseline");
  });

  it("labels a working-tree index wd when neither --ref nor --rev is given", () => {
    const run = runCli(repo, ["pkg", "--json"]);

    expect(run.status, run.stderr).toBe(0);
    const { ref, symbols } = snapshotOf(repo, JSON.parse(run.stdout).snapshotId);
    expect(ref).toBe("wd");
    expect(symbols).toEqual(["pkg/src/a.ts#gamma"]);
  });

  it("writes the default db at the toplevel for a directory deleted since the rev", async () => {
    git(repo, ["rm", "-r", "-q", "-f", "pkg"]);
    git(repo, ["commit", "-q", "-m", "remove pkg"]);

    const run = runCli(repo, ["pkg", "--rev", "HEAD~2", "--json"]);

    expect(run.status, run.stderr).toBe(0);
    const { dbPath, snapshotId } = JSON.parse(run.stdout);
    expect(dbPath).toBe(path.join(repo, ".codewatch", "graph.db"));
    expect(snapshotOf(repo, snapshotId).symbols).toEqual(["pkg/src/a.ts#alpha"]);
    await expect(fs.stat(path.join(repo, "pkg"))).rejects.toThrow();
  });

  it("exits 1 with a one-line error for an unknown rev", () => {
    const run = runCli(repo, ["pkg", "--rev", "no-such-rev"]);

    expect(run.status).toBe(1);
    expect(run.stderr.trim().split("\n")).toHaveLength(1);
    expect(run.stderr).toContain('Unknown git revision "no-such-rev"');
  });
});
