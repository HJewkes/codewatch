import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { resolveIndexDbPath } from "../commands/graph-index-run.js";

describe("the default graph index database path", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "codewatch-db-path-")));
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    await fs.mkdir(path.join(repo, "packages", "a", "src"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("resolves a nested subdirectory to the git toplevel's .codewatch/graph.db", () => {
    const nested = path.join(repo, "packages", "a", "src");

    expect(resolveIndexDbPath(undefined, nested)).toBe(path.join(repo, ".codewatch", "graph.db"));
  });

  it("uses the walked root outside git", async () => {
    const outside = await fs.mkdtemp(path.join(tmpdir(), "codewatch-db-path-nogit-"));
    try {
      expect(resolveIndexDbPath(undefined, outside)).toBe(path.join(outside, ".codewatch", "graph.db"));
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("honours an explicit --db, resolved against the cwd", () => {
    expect(resolveIndexDbPath("custom/graph.db", repo)).toBe(path.resolve("custom/graph.db"));
  });
});
