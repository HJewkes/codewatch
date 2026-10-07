import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const API = "pkg/src/a.ts";
const CALLER = "pkg/src/b.ts";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function cli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI_ENTRY, "graph", ...args], { cwd, encoding: "utf8" });
}

function indexHead(repo: string): void {
  const run = cli(repo, ["index", "pkg", "--rev", "HEAD", "--json"]);
  expect(run.status, run.stderr).toBe(0);
}

function footprintDiff(repo: string, extra: string[] = []) {
  const run = cli(repo, ["diff", "--from", "previous", "--to", "HEAD", "--footprint", "--json", ...extra]);
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

async function commitApi(repo: string, paramType: string): Promise<void> {
  await fs.writeFile(
    path.join(repo, API),
    `export function alpha(x: ${paramType}): number {\n  return Number(x);\n}\n`,
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `alpha takes ${paramType}`]);
}

// Each case spawns the CLI to index two to four times.
describe("graph diff --footprint", { timeout: 30_000 }, () => {
  let repo: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "codewatch-footprint-")));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "fixture@example.com"]);
    git(repo, ["config", "user.name", "fixture"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    await fs.mkdir(path.join(repo, "pkg", "src"), { recursive: true });
    await fs.writeFile(
      path.join(repo, CALLER),
      `import { alpha } from "./a";\n\nexport function beta(): number {\n  return alpha(1);\n}\n`,
    );
    await commitApi(repo, "number");
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("skips every unit and needs no LLM call when the source did not change", () => {
    indexHead(repo);
    indexHead(repo);

    const result = footprintDiff(repo);

    expect(result.changes).toEqual([]);
    expect(result.gate.regenerate).toEqual([]);
    expect(result.gate.skip).toEqual([API, CALLER]);
    expect(result.llmCallNeeded).toBe(false);
    expect(result.provenance).toHaveLength(2);
    for (const record of result.provenance) {
      expect(record.model).toBeNull();
      expect(record.commit).toBe(git(repo, ["rev-parse", "HEAD"]));
    }
  });

  it("regenerates only the declaring file's unit after a signature change", async () => {
    indexHead(repo);
    await commitApi(repo, "string");
    indexHead(repo);

    const result = footprintDiff(repo);

    expect(result.changes).toEqual([
      expect.objectContaining({ symbolId: `${API}#alpha`, status: "changed", reasons: ["signature"] }),
    ]);
    expect(result.gate.regenerate).toEqual([{ unitId: API, reason: "changed" }]);
    expect(result.gate.skip).toEqual([CALLER]);
    expect(result.llmCallNeeded).toBe(true);
  });

  it("gates against a --provenance file instead of the from-snapshot", async () => {
    indexHead(repo);
    indexHead(repo);
    const priorFile = path.join(repo, "prior.json");
    await fs.writeFile(priorFile, JSON.stringify(footprintDiff(repo)));
    await commitApi(repo, "string");
    indexHead(repo);
    indexHead(repo);

    const withoutPrior = footprintDiff(repo);
    const withPrior = footprintDiff(repo, ["--provenance", priorFile]);

    expect(withoutPrior.llmCallNeeded).toBe(false);
    expect(withPrior.gate.regenerate).toEqual([{ unitId: API, reason: "changed" }]);
    expect(withPrior.llmCallNeeded).toBe(true);
  });

  it("gates caller-defined --units", async () => {
    indexHead(repo);
    await commitApi(repo, "string");
    indexHead(repo);
    const unitsFile = path.join(repo, "units.json");
    await fs.writeFile(unitsFile, JSON.stringify([{ unitId: "api-docs", symbolIds: [`${API}#alpha`] }]));

    const result = footprintDiff(repo, ["--units", unitsFile]);

    expect(result.gate.regenerate).toEqual([{ unitId: "api-docs", reason: "changed" }]);
    expect(result.provenance.map((p: { unitId: string }) => p.unitId)).toEqual(["api-docs"]);
  });

  it("errors clearly when --from previous has no prior snapshot", () => {
    indexHead(repo);

    const run = cli(repo, ["diff", "--from", "previous", "--to", "HEAD", "--footprint"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--from: "previous" requires at least one prior snapshot');
  });
});
