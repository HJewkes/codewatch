import { describe, it, expect } from "vitest";
import { parseFile } from "@titan-design/code-parser";
import { scriptFacts } from "../commands/audit-script-facts.js";

const mjs = (text: string) => parseFile(text, "s.mjs", "typescript");
const py = (text: string) => parseFile(text, "s.py", "python");

describe("script facts", () => {
  it("counts the integer returns of the function the guard exits with, one hop deep", async () => {
    const facts = scriptFacts(
      await mjs(`function inner() { return 7; }
function run(argv) {
  const helper = () => { return 9; };
  if (argv.length === 0) return 4;
  return inner();
}
if (import.meta.main) process.exit(run(process.argv));
`),
    );
    expect(facts).toEqual({ guardLine: 7, exitCodes: [0, 4], flags: [] });
  });

  it("counts each branch of a conditional exit code", async () => {
    const facts = scriptFacts(
      await py(`import sys


def main():
    return 0 if sys.argv[1:] else 5


if __name__ == "__main__":
    sys.exit(6 if len(sys.argv) > 3 else main())
`),
    );
    expect(facts?.exitCodes).toEqual([0, 5, 6]);
    expect(facts?.guardLine).toBe(8);
  });

  it("adds exit code 1 for a throw no try encloses", async () => {
    const uncaught = scriptFacts(await mjs(`#!/usr/bin/env node\nthrow new Error("boom");\n`));
    const caught = scriptFacts(await mjs(`#!/usr/bin/env node\ntry {\n  throw new Error("boom");\n} catch {}\n`));
    expect(uncaught?.exitCodes).toEqual([0, 1]);
    expect(caught?.exitCodes).toEqual([0]);
  });

  it("reads accepted flags from argv.includes, parseArgs options and add_argument", async () => {
    const node = scriptFacts(
      await mjs(`import { parseArgs } from "node:util";
const { values } = parseArgs({ options: { "dry-run": { type: "boolean" }, out: { type: "string" } } });
if (process.argv.includes("--check")) process.exitCode = 1;
if (require.main === module) console.log(values);
`),
    );
    const python = scriptFacts(await py(`import argparse\np = argparse.ArgumentParser()\np.add_argument("-q", "--quiet")\nif __name__ == "__main__":\n    p.parse_args()\n`));
    expect(node?.flags).toEqual(["--check", "--dry-run", "--out"]);
    expect(python?.flags).toEqual(["--quiet"]);
  });

  it("gives nothing for a module with no entry guard", async () => {
    expect(scriptFacts(await mjs(`export function run() { process.exit(2); }\n`))).toBeUndefined();
  });
});
