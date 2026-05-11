import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { installHook, removeHook, stripBlock } from "../commands/hook.js";

let testDir: string;
let hookPath: string;

beforeEach(async () => {
  testDir = path.join(tmpdir(), `code-style-hook-test-${Date.now()}-${Math.random()}`);
  await fs.mkdir(path.join(testDir, ".git", "hooks"), { recursive: true });
  hookPath = path.join(testDir, ".git", "hooks", "pre-commit");
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("installHook", () => {
  it("creates a pre-commit hook file containing the style diff line", async () => {
    await installHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("code-style diff --fix");
    expect(content).toContain("code-style pre-commit hook (begin)");
    expect(content).toContain("code-style pre-commit hook (end)");
  });

  it("makes the hook executable", async () => {
    await installHook(testDir);
    const stat = await fs.stat(hookPath);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("appends to an existing pre-commit hook without losing user lines", async () => {
    await fs.writeFile(hookPath, "#!/bin/sh\necho existing\n");
    await installHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("echo existing");
    expect(content).toContain("code-style diff --fix");
  });

  it("re-running install does not duplicate the block", async () => {
    await installHook(testDir);
    await installHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content.match(/code-style diff --fix/g)).toHaveLength(1);
    expect(content.match(/code-style pre-commit hook \(begin\)/g)).toHaveLength(1);
  });

  it("re-running install can swap to a new block (graph check on)", async () => {
    await installHook(testDir);
    await installHook(testDir, { withGraphCheck: true });
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("graph index");
    expect(content).toContain("graph check");
    expect(content.match(/code-style diff --fix/g)).toHaveLength(1);
  });

  it("includes the conditional graph check when --with-graph-check is set", async () => {
    await installHook(testDir, { withGraphCheck: true });
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("git diff --cached --name-only");
    expect(content).toContain(
      "code-style graph index . --db .codewatch/graph.db >/dev/null",
    );
    expect(content).toContain("code-style graph check --db .codewatch/graph.db");
  });

  it("uses a custom graph path when provided", async () => {
    await installHook(testDir, { withGraphCheck: true, graphPath: "packages" });
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("code-style graph index packages");
  });

  it("passes --db to both index and check so they share a snapshot", async () => {
    await installHook(testDir, { withGraphCheck: true, graphPath: "packages" });
    const content = await fs.readFile(hookPath, "utf-8");
    const indexLine = content.split("\n").find((l) => l.includes("graph index"))!;
    const checkLine = content.split("\n").find((l) => l.includes("graph check"))!;
    const dbOf = (line: string): string | undefined =>
      /--db ([^\s]+)/.exec(line)?.[1];
    expect(dbOf(indexLine)).toBe(".codewatch/graph.db");
    expect(dbOf(checkLine)).toBe(".codewatch/graph.db");
    expect(dbOf(indexLine)).toBe(dbOf(checkLine));
  });

  it("respects a custom dbPath", async () => {
    await installHook(testDir, {
      withGraphCheck: true,
      graphPath: "packages",
      dbPath: "tmp/graph.db",
    });
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("graph index packages --db tmp/graph.db");
    expect(content).toContain("graph check --db tmp/graph.db");
  });

  it("omits the style check line when withStyleCheck=false", async () => {
    await installHook(testDir, {
      withStyleCheck: false,
      withGraphCheck: true,
      graphPath: "packages",
    });
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).not.toContain("code-style diff");
    expect(content).toContain("code-style graph index packages");
  });

  it("throws when both style and graph check are disabled", async () => {
    await expect(
      installHook(testDir, { withStyleCheck: false, withGraphCheck: false }),
    ).rejects.toThrow(/empty hook/);
  });

  it("uses a custom binary command in every line of the block", async () => {
    await installHook(testDir, {
      withGraphCheck: true,
      graphPath: "packages",
      bin: "pnpm exec code-style",
    });
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("pnpm exec code-style diff --fix");
    expect(content).toContain("pnpm exec code-style graph index packages");
    expect(content).toContain("pnpm exec code-style graph check");
    const commandLines = content
      .split("\n")
      .filter((line) => /code-style/.test(line) && !line.trim().startsWith("#"));
    expect(commandLines).not.toEqual([]);
    for (const line of commandLines) {
      expect(line).toMatch(/pnpm exec code-style/);
    }
  });
});

describe("removeHook", () => {
  it("removes the entire code-style block from the hook", async () => {
    await installHook(testDir, { withGraphCheck: true });
    await removeHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).not.toContain("code-style");
    expect(content).not.toContain("pre-commit hook (begin)");
    expect(content).not.toContain("pre-commit hook (end)");
  });

  it("preserves user lines surrounding the block", async () => {
    await fs.writeFile(
      hookPath,
      [
        "#!/bin/sh",
        "echo before",
        "# code-style pre-commit hook (begin)",
        "code-style diff --fix",
        "# code-style pre-commit hook (end)",
        "echo after",
        "",
      ].join("\n"),
    );
    await removeHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("echo before");
    expect(content).toContain("echo after");
    expect(content).not.toContain("code-style");
  });

  it("is a no-op when no hook file exists", async () => {
    await expect(removeHook(testDir)).resolves.not.toThrow();
  });
});

describe("stripBlock", () => {
  it("removes content between marker comments inclusive", () => {
    const before = [
      "before",
      "  # code-style pre-commit hook (begin)",
      "code-style diff",
      "code-style graph check",
      "  # code-style pre-commit hook (end)",
      "after",
    ].join("\n");
    expect(stripBlock(before)).toBe("before\nafter\n");
  });

  it("returns input unchanged when no block is present", () => {
    expect(stripBlock("a\nb\n")).toBe("a\nb\n");
  });
});
