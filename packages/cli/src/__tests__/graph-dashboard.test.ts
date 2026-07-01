import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openDatabase } from "@codewatch/graph";
import { runGraphDashboardCommand } from "../commands/graph-dashboard.js";

/** Parse the `window.__CODEWATCH__ = {...};` payload out of the generated HTML. */
function extractPayload(html: string): Record<string, any> {
  const m = html.match(/window\.__CODEWATCH__ = (\{.*?\});(?:window\.__CODEWATCH|<\/script>)/s);
  if (!m) throw new Error("payload not found in HTML");
  return JSON.parse(m[1]!);
}

async function fixture(): Promise<{ dir: string; dbPath: string; out: string }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "codewatch-dashboard-"));
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

  // Regression: `hidden` on a coupling pair was hardcoded false, so the
  // dashboard's flagship "hidden coupling" signal never fired. It must now be
  // computed as "co-changed but NOT joined by an imports/re-exports edge".
  it("marks co-changed pairs hidden iff they have no import edge", async () => {
    const dirLocal = await fs.mkdtemp(path.join(tmpdir(), "codewatch-coupling-"));
    dir = dirLocal;
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dirLocal,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@example.com",
          GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@example.com",
        },
      });
    git("init", "-q");
    const write = (name: string, body: string) => fs.writeFile(path.join(dirLocal, name), body);
    // a↔b co-change twice (and a imports b → expected); c↔d co-change twice with
    // no edge between them → hidden (both are connected to the graph via imports
    // of a, so the pair is verifiable — just not import-backed to each other).
    await Promise.all([write("a.ts", "1\n"), write("b.ts", "1\n"), write("c.ts", "1\n"), write("d.ts", "1\n")]);
    git("add", "a.ts", "b.ts"); git("commit", "-qm", "ab1");
    await Promise.all([write("a.ts", "2\n"), write("b.ts", "2\n")]);
    git("add", "a.ts", "b.ts"); git("commit", "-qm", "ab2");
    git("add", "c.ts", "d.ts"); git("commit", "-qm", "cd1");
    await Promise.all([write("c.ts", "2\n"), write("d.ts", "2\n")]);
    git("add", "c.ts", "d.ts"); git("commit", "-qm", "cd2");

    const dbPath = path.join(dirLocal, "graph.db");
    const db = openDatabase(dbPath);
    const sid = db.createSnapshot({ ref: "main", indexVersion: "0.2.0" });
    db.insertNodes(sid, ["a.ts", "b.ts", "c.ts", "d.ts"].map((id) => ({ id, kind: "file" as const, name: id, role: "source" as const })));
    db.insertEdges(sid, [
      { srcId: "a.ts", dstId: "b.ts", kind: "imports" as const },
      // c and d each import a → both are "connected" (have resolved internal
      // imports), so their import-less co-change is genuinely hidden, not merely
      // unverifiable.
      { srcId: "c.ts", dstId: "a.ts", kind: "imports" as const },
      { srcId: "d.ts", dstId: "a.ts", kind: "imports" as const },
    ]);
    db.close();

    const out = path.join(dirLocal, "out.html");
    await runGraphDashboardCommand({ db: dbPath, config: "/nope/check.json", out, repoRoot: dirLocal, repo: "fx" });
    const payload = extractPayload(await fs.readFile(out, "utf8"));
    const find = (x: string, y: string) =>
      payload.couplingClusters.find((c: any) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
    expect(find("a.ts", "b.ts")?.hidden).toBe(false); // import-backed → expected
    expect(find("c.ts", "d.ts")?.hidden).toBe(true); // no edge → hidden
  });
});
