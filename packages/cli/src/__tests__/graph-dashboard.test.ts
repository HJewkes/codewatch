import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openDatabase } from "@code-style/graph";
import { runGraphDashboardCommand } from "../commands/graph-dashboard.js";

/** Parse the `window.__CODEWATCH__ = {...};` payload out of the generated HTML. */
function extractPayload(html: string): Record<string, any> {
  const m = html.match(/window\.__CODEWATCH__ = (\{.*?\});(?:window\.__CODEWATCH|<\/script>)/s);
  if (!m) throw new Error("payload not found in HTML");
  return JSON.parse(m[1]!);
}

async function fixture(): Promise<{ dir: string; dbPath: string; out: string }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "code-style-dashboard-"));
  const dbPath = path.join(dir, "graph.db");
  const db = openDatabase(dbPath);
  const snapshotId = db.createSnapshot({ ref: "main", indexVersion: "0.2.0" });
  db.insertNodes(snapshotId, [
    { id: "src/a.ts", kind: "file", name: "a", role: "source" },
  ]);
  db.insertMetrics(snapshotId, [
    { nodeId: "src/a.ts", name: "churn_30d", value: 20 },
    { nodeId: "src/a.ts", name: "cognitive_max", value: 12 },
  ]);
  db.close();
  return { dir, dbPath, out: path.join(dir, "out.html") };
}

describe("runGraphDashboardCommand", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a self-contained HTML with the payload injected", async () => {
    const fx = await fixture();
    dir = fx.dir;
    const { out, snapshotId } = await runGraphDashboardCommand({
      db: fx.dbPath,
      config: path.join(fx.dir, "missing-check.json"), // absent → no violations, no throw
      out: fx.out,
      repoRoot: fx.dir,
      repo: "fixture",
    });
    expect(out).toBe(fx.out);
    const html = await fs.readFile(fx.out, "utf8");
    expect(html).toContain("window.__CODEWATCH__");
    expect(html).toContain("src/a.ts"); // the hotspot made it into the payload
    // Injected before </head> so the app reads it before mounting.
    expect(html.indexOf("window.__CODEWATCH__")).toBeLessThan(html.indexOf("</head>"));
    expect(snapshotId).toBeGreaterThan(0);
  });

  it("does not throw when the check config is missing (Fitness renders clear)", async () => {
    const fx = await fixture();
    dir = fx.dir;
    await expect(
      runGraphDashboardCommand({ db: fx.dbPath, config: "/nope/check.json", out: fx.out, repoRoot: fx.dir }),
    ).resolves.toBeTruthy();
  });

  it("always includes testCoverageRisks as an array in the payload", async () => {
    const fx = await fixture();
    dir = fx.dir;
    await runGraphDashboardCommand({
      db: fx.dbPath, config: "/nope/check.json", out: fx.out, repoRoot: fx.dir, repo: "fixture",
    });
    const payload = extractPayload(await fs.readFile(fx.out, "utf8"));
    expect(Array.isArray(payload.testCoverageRisks)).toBe(true);
  });

  // Regression for the dead single-author guard: `graph dashboard` must emit
  // meta.authorCount so the dashboard's `authorCount === 1` guard can fire.
  // Before this fix the field was never emitted, so the guard was dead and the
  // degenerate bus-factor table always rendered.
  it("emits meta.authorCount from git churn so the single-author guard can fire", async () => {
    const fx = await fixture();
    dir = fx.dir;
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: fx.dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Solo Dev", GIT_AUTHOR_EMAIL: "solo@example.com",
          GIT_COMMITTER_NAME: "Solo Dev", GIT_COMMITTER_EMAIL: "solo@example.com",
        },
      });
    git("init", "-q");
    await fs.writeFile(path.join(fx.dir, "a.ts"), "export const a = 1;\n");
    git("add", "a.ts");
    git("commit", "-qm", "add a");

    await runGraphDashboardCommand({
      db: fx.dbPath, config: "/nope/check.json", out: fx.out, repoRoot: fx.dir, repo: "fixture",
    });
    const payload = extractPayload(await fs.readFile(fx.out, "utf8"));
    expect(payload.meta.authorCount).toBe(1);
  });
});
