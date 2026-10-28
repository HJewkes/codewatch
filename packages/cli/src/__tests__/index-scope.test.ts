import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Extractor } from "@titan-design/style-analyzer";
import { runAnalyze } from "../commands/analyze.js";
import { runAuditCommand } from "../commands/audit.js";
import { scopeToProject } from "../commands/index-scope.js";
import { planTriage } from "../commands/triage-plan.js";
import { SILENT_RUNNERS } from "./triage-fake-reader.js";

const SWALLOWING_SRC = `def load(path):
    try:
        return open(path).read()
    except OSError:
        pass
    try:
        return path.read_text()
    except AttributeError:
        pass
    return ""
`;

const VENV_MODULE = ".venv/lib/python3.12/site-packages/pkg/mod.py";

function write(root: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, stdio: "ignore" });
}

/** A committed module, an untracked and unignored virtualenv, and an untracked scratch file, all with the same finding. */
function fixtureRepo(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "codewatch-index-scope-")));
  git(root, "init", "-q");
  write(root, "app/load.py", SWALLOWING_SRC);
  git(root, "add", "app/load.py");
  git(root, "commit", "-q", "-m", "init");
  write(root, ".venv/pyvenv.cfg", "home = /usr/bin\n");
  write(root, VENV_MODULE, SWALLOWING_SRC);
  write(root, "scratch.py", SWALLOWING_SRC);
  return root;
}

describe("audit and triage of a workspace holding a virtualenv (C-216)", () => {
  let root: string;

  beforeEach(() => {
    root = fixtureRepo();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("audits the project's files and nothing under the virtualenv", async () => {
    const { findings } = await runAuditCommand({ path: root, noRuff: true, noTsSlop: true, runners: SILENT_RUNNERS });

    const paths = new Set(findings.map((f) => f.path));
    expect([...paths].filter((p) => p.startsWith(".venv/"))).toEqual([]);
    expect(paths).toContain("app/load.py");
  });

  it("keeps an untracked file no ignore rule covers, since a solve's new modules are often uncommitted", async () => {
    const { findings } = await runAuditCommand({ path: root, noRuff: true, noTsSlop: true, runners: SILENT_RUNNERS });

    expect(findings.map((f) => f.path)).toContain("scratch.py");
  });

  it("asks triage no question about the virtualenv, so no verdict or taste line can cite it", async () => {
    await runAuditCommand({ path: root, noRuff: true, noTsSlop: true, runners: SILENT_RUNNERS });

    const plan = planTriage({ path: root, minRank: 0, includeTests: false });

    const asked = plan.bundles.flatMap((b) => b.questions.map((q) => q.finding.path));
    expect(asked).toContain("app/load.py");
    expect(asked.filter((p) => p.startsWith(".venv/"))).toEqual([]);
  });
});

describe("analyze of a workspace holding a virtualenv (C-217)", () => {
  let root: string;

  beforeEach(() => {
    root = fixtureRepo();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads the project's files and nothing under the virtualenv", async () => {
    const parsed: string[] = [];
    const recorder: Extractor = { name: "recorder", extract: (file) => (parsed.push(file.filePath), []) };

    const result = await runAnalyze({ rootDir: root, languages: ["python"], extractors: [recorder] });

    expect(parsed.map((abs) => path.relative(root, abs)).sort()).toEqual(["app/load.py", "scratch.py"]);
    expect(result.files.total).toBe(2);
  });
});

describe("scopeToProject", () => {
  let root: string;

  beforeEach(() => {
    root = fixtureRepo();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const abs = (...rels: string[]): string[] => rels.map((rel) => path.join(root, rel));

  it("drops gitignored files and untracked virtualenvs under any name", () => {
    write(root, ".gitignore", "generated/\n");
    write(root, "generated/out.py", "");
    write(root, "env/pyvenv.cfg", "");
    write(root, "env/lib/site.py", "");
    write(root, "pkg/__pycache__/stub.py", "");

    const walked = abs("app/load.py", "scratch.py", VENV_MODULE, "generated/out.py", "env/lib/site.py", "pkg/__pycache__/stub.py");

    expect(scopeToProject(walked, [root])).toEqual(abs("app/load.py", "scratch.py"));
  });

  it("keeps a tracked file even inside a directory named like a tool env", () => {
    write(root, "node_modules/vendored.py", "");
    git(root, "add", "-f", "node_modules/vendored.py");

    expect(scopeToProject(abs("node_modules/vendored.py"), [root])).toEqual(abs("node_modules/vendored.py"));
  });

  it("drops tool envs outside a git work tree", () => {
    const plain = realpathSync(mkdtempSync(path.join(tmpdir(), "codewatch-index-scope-plain-")));
    try {
      write(plain, "a.py", "");
      write(plain, "v/pyvenv.cfg", "");
      write(plain, "v/lib/b.py", "");
      write(plain, ".tox/c.py", "");
      const walked = ["a.py", "v/lib/b.py", ".tox/c.py"].map((rel) => path.join(plain, rel));

      expect(scopeToProject(walked, [plain])).toEqual([path.join(plain, "a.py")]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
