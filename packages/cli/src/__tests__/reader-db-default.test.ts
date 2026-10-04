import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { runGraphIndex } from "../commands/graph-index-run.js";
import { registerGraphTop } from "../commands/graph-top.js";
import { registerGraphSimilar } from "../commands/graph-similar.js";

function graphProgram(register: (graph: Command) => void): Command {
  const program = new Command().exitOverride();
  register(program.command("graph"));
  return program;
}

describe("reader commands without --db", () => {
  let repo: string;
  let nested: string;

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "codewatch-reader-db-")));
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    nested = path.join(repo, "src", "deep");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(repo, "src", "a.ts"), "export const A = 1;\n");
    await runGraphIndex({ rootDir: repo });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it("reads the git toplevel index from a subdirectory and creates no .codewatch there", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue(nested);

    await graphProgram(registerGraphTop).parseAsync(["graph", "top", "--metric", "loc", "--json"], { from: "user" });

    expect(process.exitCode).toBeUndefined();
    expect(log.mock.calls.join("\n")).toContain("src/a.ts");
    expect(existsSync(path.join(nested, ".codewatch"))).toBe(false);
  });

  it("fails with a clear message and creates nothing when the index is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.rm(path.join(repo, ".codewatch"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(nested);

    await graphProgram(registerGraphSimilar).parseAsync(["graph", "similar", "anything"], {
      from: "user",
    });

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.join("\n")).toContain("run codewatch graph index");
    expect(existsSync(path.join(nested, ".codewatch"))).toBe(false);
    expect(existsSync(path.join(repo, ".codewatch"))).toBe(false);
  });
});
