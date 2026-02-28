import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("installHook", () => {
  let testDir: string;
  let hooksDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-hook-test-${Date.now()}`);
    hooksDir = path.join(testDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates a pre-commit hook file", async () => {
    const { installHook } = await import("../commands/hook.js");
    await installHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("code-style");
    expect(content).toContain("diff --fix");
  });

  it("makes the hook file executable", async () => {
    const { installHook } = await import("../commands/hook.js");
    await installHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const stat = await fs.stat(hookPath);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("appends to existing pre-commit hook", async () => {
    const { installHook } = await import("../commands/hook.js");
    const hookPath = path.join(hooksDir, "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\necho existing\n");
    await installHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("echo existing");
    expect(content).toContain("code-style");
  });

  it("does not duplicate if hook already contains code-style", async () => {
    const { installHook } = await import("../commands/hook.js");
    await installHook(testDir);
    await installHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const content = await fs.readFile(hookPath, "utf-8");
    const matches = content.match(/code-style diff/g);
    expect(matches).toHaveLength(1);
  });
});

describe("removeHook", () => {
  let testDir: string;
  let hooksDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `code-style-hook-test-${Date.now()}`);
    hooksDir = path.join(testDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("removes the code-style line from the pre-commit hook", async () => {
    const { installHook, removeHook } = await import("../commands/hook.js");
    await installHook(testDir);
    await removeHook(testDir);
    const hookPath = path.join(hooksDir, "pre-commit");
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).not.toContain("code-style");
  });

  it("preserves other hook content when removing", async () => {
    const hookPath = path.join(hooksDir, "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\necho existing\ncode-style diff\n");
    const { removeHook } = await import("../commands/hook.js");
    await removeHook(testDir);
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("echo existing");
    expect(content).not.toContain("code-style");
  });

  it("handles missing hook file gracefully", async () => {
    const { removeHook } = await import("../commands/hook.js");
    await expect(removeHook(testDir)).resolves.not.toThrow();
  });
});
