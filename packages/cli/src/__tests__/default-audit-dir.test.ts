import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defaultAuditDir } from "../commands/triage-plan.js";

describe("defaultAuditDir", () => {
  let dir: string;

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("falls back to the given root outside a git repo", () => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), "codewatch-audit-dir-")));

    expect(defaultAuditDir(dir)).toBe(path.join(dir, ".codewatch", "audit"));
  });
});
