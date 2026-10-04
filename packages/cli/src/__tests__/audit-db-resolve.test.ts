import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runAuditCommand } from "../commands/audit.js";

describe("audit from a subdirectory of a git repo", () => {
  let repo: string;
  let nested: string;

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "codewatch-audit-db-")));
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    nested = path.join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "a.ts"), "export const A = 1;\n");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("writes the db and audit output at the git toplevel and creates no .codewatch in the subdirectory", async () => {
    const result = await runAuditCommand({ path: nested, noRuff: true });

    expect(result.dbPath).toBe(path.join(repo, ".codewatch", "graph.db"));
    expect(result.outDir).toBe(path.join(repo, ".codewatch", "audit"));
    expect(existsSync(path.join(nested, ".codewatch"))).toBe(false);
  });
});
