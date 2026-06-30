import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "@code-style/graph";
import { runGraphAutoUpdate } from "../commands/graph-auto-update.js";

let rootDir: string;
let dbPath: string;
let configPath: string;

async function writeConfig(value: unknown): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(value), "utf-8");
}

function snapshotCount(): number {
  const db = openDatabase(dbPath);
  try {
    return db.listSnapshots().length;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(tmpdir(), "code-style-auto-update-"));
  dbPath = path.join(rootDir, ".codewatch", "graph.db");
  configPath = path.join(rootDir, "check.json");
  await fs.writeFile(path.join(rootDir, "a.ts"), "export const x = 1;\n");
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe("runGraphAutoUpdate", () => {
  it("re-indexes when autoUpdate is enabled", async () => {
    await writeConfig({ autoUpdate: true, rules: [] });
    const out = await runGraphAutoUpdate({
      rootDirs: [rootDir],
      dbPath,
      configPath,
    });
    expect(out.ran).toBe(true);
    expect(out.result?.snapshotId).toBeGreaterThan(0);
    expect(snapshotCount()).toBe(1);
  });

  it("no-ops when autoUpdate is false", async () => {
    await writeConfig({ autoUpdate: false, rules: [] });
    const out = await runGraphAutoUpdate({
      rootDirs: [rootDir],
      dbPath,
      configPath,
    });
    expect(out.ran).toBe(false);
    expect(out.result).toBeUndefined();
  });

  it("no-ops when the flag is absent", async () => {
    await writeConfig({ rules: [] });
    const out = await runGraphAutoUpdate({
      rootDirs: [rootDir],
      dbPath,
      configPath,
    });
    expect(out.ran).toBe(false);
  });

  it("no-ops (does not throw) when the config is missing", async () => {
    const out = await runGraphAutoUpdate({
      rootDirs: [rootDir],
      dbPath,
      configPath: path.join(rootDir, "nonexistent.json"),
    });
    expect(out.ran).toBe(false);
  });

  it("no-ops (does not throw) when the config is invalid JSON", async () => {
    await fs.writeFile(configPath, "{ not valid json", "utf-8");
    const out = await runGraphAutoUpdate({
      rootDirs: [rootDir],
      dbPath,
      configPath,
    });
    expect(out.ran).toBe(false);
  });

  it("reuses byte-identical files on a second enabled run (incremental)", async () => {
    await writeConfig({ autoUpdate: true, rules: [] });
    await runGraphAutoUpdate({ rootDirs: [rootDir], dbPath, configPath });
    const second = await runGraphAutoUpdate({
      rootDirs: [rootDir],
      dbPath,
      configPath,
    });
    expect(second.result?.reusedFiles).toBe(second.result?.files);
    expect(second.result?.reparsedFiles).toBe(0);
  });
});
