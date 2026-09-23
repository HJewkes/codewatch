import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "@titan-design/code-graph";
import type { RunnerResult } from "@titan-design/style-checker";
import { runAuditCommand } from "../commands/audit.js";
import { PYTHON_TOOLS, type PythonRunners } from "../commands/audit-runners.js";

const EMPTY: RunnerResult = { diagnostics: [], exitCode: 0, failures: [], skippedRules: [] };
const SILENT_RUNNERS: PythonRunners = Object.fromEntries(PYTHON_TOOLS.map((tool) => [tool, () => Promise.resolve(EMPTY)]));

const WRAPPER_SRC = `from pkg.core import compute


def wrapper(a, b):
    return compute(a, b)
`;

const CORE_SRC = `def compute(a, b):
    total = a * 2
    if b > total:
        total = b - a
    return total + b
`;

const NARRATED_SRC = `def tally(items):
    counter = 0
    for item in items:
        # increment the counter
        counter += item
    return counter
`;

const COMMENTED_SRC = `def explained(x):
    # The caller passes a raw reading straight from the sensor.
    # Readings below zero come from a known calibration fault.
    # We clamp them rather than raise, matching the vendor tool.
    # See the vendor manual, section four, for the full story.
    return max(x, 0)
`;

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

const FILLER_COUNT = 22;
const MODERATE_COUNT = 3;

function moderateSrc(i: number): string {
  return `import logging


def moderate_${i}(x):
    # Sensor units differ by vendor.
    y = x + ${i}
    z = y * 2
    w = z - 1
    v = w + y
    try:
        u = v / x
    except ZeroDivisionError:
        logging.warning("zero reading")
        u = 0
    return u + v
`;
}

function fillerSrc(i: number): string {
  return `def filler_${i}(x):\n    y = x + ${i}\n    return y * 2\n`;
}

let dir: string;
let findings: Finding[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "c105-tier-c-"));
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg", "__init__.py"), "");
  writeFileSync(join(dir, "pkg", "wrapper.py"), WRAPPER_SRC);
  writeFileSync(join(dir, "pkg", "core.py"), CORE_SRC);
  writeFileSync(join(dir, "pkg", "narrated.py"), NARRATED_SRC);
  writeFileSync(join(dir, "pkg", "commented.py"), COMMENTED_SRC);
  writeFileSync(join(dir, "pkg", "swallowing.py"), SWALLOWING_SRC);
  for (let i = 0; i < FILLER_COUNT; i++) writeFileSync(join(dir, "pkg", `filler_${i}.py`), fillerSrc(i));
  for (let i = 0; i < MODERATE_COUNT; i++) writeFileSync(join(dir, "pkg", `moderate_${i}.py`), moderateSrc(i));
  const result = await runAuditCommand({ path: dir, noRuff: true, runners: SILENT_RUNNERS });
  findings = result.findings;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function flagged(signal: string): string[] {
  return findings
    .filter((f) => f.signal === signal)
    .map((f) => (f.symbol ? `${f.path}#${f.symbol}` : f.path))
    .sort();
}

describe("codewatch audit Tier C rules", () => {
  it("flags the function that only forwards its arguments as symbol-pass-through, not the function doing the work", () => {
    expect(flagged("symbol-pass-through")).toEqual(["pkg/wrapper.py#wrapper"]);
  });

  it("flags the comment that restates the next statement as symbol-narrating-comments", () => {
    expect(flagged("symbol-narrating-comments")).toEqual(["pkg/narrated.py#tally"]);
  });

  it("flags the two comment-heavy functions above the 90th percentile as symbol-comment-ratio, not the lightly commented ones", () => {
    expect(flagged("symbol-comment-ratio")).toEqual(["pkg/commented.py#explained", "pkg/narrated.py#tally"]);
  });

  it("flags the file whose handlers only pass as file-swallowed-except", () => {
    expect(flagged("file-swallowed-except")).toEqual(["pkg/swallowing.py"]);
  });

  it("flags the file dense with except handlers as file-except-density, not the files with one handler in a longer body", () => {
    expect(flagged("file-except-density")).toEqual(["pkg/swallowing.py"]);
  });

  it("reports every Tier C finding from code-graph as a warning", () => {
    const tierC = findings.filter((f) => f.signal !== "symbol-cognitive");
    expect(new Set(tierC.map((f) => `${f.tool}:${f.severity}`))).toEqual(new Set(["code-graph:warning"]));
  });
});
