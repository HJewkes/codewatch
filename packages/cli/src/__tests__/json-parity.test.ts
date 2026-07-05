import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { validateRules, type SnapshotRow } from "@codewatch/graph";
import { registerGraphCommands } from "../commands/graph-cli.js";
import { runGraphInitCommand } from "../commands/graph-init.js";
import { formatArchJson } from "../commands/graph-arch-format.js";
import type { ArchResult } from "../commands/graph-arch.js";
import { formatGraphCoverageJson } from "../commands/graph-coverage.js";

/**
 * Operational subcommands that emit an HTML/image artifact or run as a git hook,
 * not a JSON data model — legitimately exempt from `--json`. Any OTHER graph
 * subcommand must accept `--json` (C-7 parity guarantee); adding a data command
 * without `--json` fails this test automatically.
 */
const JSON_EXEMPT = new Set([
  "dashboard",
  "render",
  "render-diff",
  "render-check-diff",
  "auto-update",
]);

function graphSubcommands(): Command[] {
  const program = new Command();
  registerGraphCommands(program);
  const graph = program.commands.find((c) => c.name() === "graph");
  if (!graph) throw new Error("graph command not registered");
  return [...graph.commands];
}

function hasJsonFlag(cmd: Command): boolean {
  return cmd.options.some((o) => o.long === "--json");
}

describe("graph --json parity (C-7)", () => {
  it("every data subcommand accepts --json", () => {
    const missing = graphSubcommands()
      .filter((c) => !JSON_EXEMPT.has(c.name()))
      .filter((c) => !hasJsonFlag(c))
      .map((c) => c.name());
    expect(missing).toEqual([]);
  });

  it("exempt subcommands are all still registered (allowlist not stale)", () => {
    const names = new Set(graphSubcommands().map((c) => c.name()));
    for (const exempt of JSON_EXEMPT) expect(names.has(exempt)).toBe(true);
  });
});

describe("new --json formatters round-trip valid JSON (C-7)", () => {
  const snapshot = { id: 1, ref: "main" } as SnapshotRow;

  it("graph arch --json emits the documented data-model keys", () => {
    const result: ArchResult = {
      snapshot,
      packages: [],
      edges: [],
      includesExternal: false,
    };
    const json = JSON.parse(formatArchJson(result));
    expect(json.snapshot).toMatchObject({ id: 1, ref: "main" });
    expect(json.packages).toEqual([]);
    expect(json.edges).toEqual([]);
  });

  it("graph coverage --json emits snapshotId/files/symbols", () => {
    const json = JSON.parse(
      formatGraphCoverageJson({ snapshotId: 7, files: 3, symbols: 12 }),
    );
    expect(json).toEqual({ snapshotId: 7, files: 3, symbols: 12 });
  });
});

describe("graph init scaffolder (C-7)", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a schema-valid default check.json and reports it written", async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-init-"));
    const result = await runGraphInitCommand({ path: dir });

    expect(result.config).toBe("written");
    expect(result.hookInstalled).toBe(false);
    expect(result.seededSnapshotId).toBeNull();

    const raw = await fs.readFile(result.configPath, "utf8");
    const parsed = JSON.parse(raw) as { rules: unknown[] };
    expect(parsed.rules.length).toBeGreaterThan(0);
    // validateRules throws on an invalid rule shape.
    const rules = validateRules(parsed, { onWarn: () => {} });
    expect(rules.length).toBe(parsed.rules.length);
  });

  it("keeps an existing check.json unless --force is given", async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-init-"));
    await runGraphInitCommand({ path: dir });

    const configPath = path.join(dir, ".codewatch", "check.json");
    await fs.writeFile(configPath, JSON.stringify({ rules: [] }));

    const kept = await runGraphInitCommand({ path: dir });
    expect(kept.config).toBe("skipped");
    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual({ rules: [] });

    const forced = await runGraphInitCommand({ path: dir, force: true });
    expect(forced.config).toBe("written");
    expect(
      (JSON.parse(await fs.readFile(configPath, "utf8")) as { rules: unknown[] })
        .rules.length,
    ).toBeGreaterThan(0);
  });

  it("emits the documented JSON shape", async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-init-"));
    const { formatGraphInitJson } = await import("../commands/graph-init.js");
    const result = await runGraphInitCommand({ path: dir });
    const json = JSON.parse(formatGraphInitJson(result));
    expect(json).toMatchObject({
      config: "written",
      hookInstalled: false,
      seededSnapshotId: null,
    });
    expect(typeof json.configPath).toBe("string");
  });
});
