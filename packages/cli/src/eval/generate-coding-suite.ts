import { writeFileSync } from "node:fs";
import { generateCodingSuite } from "./coding-generate.js";

/**
 * Standalone runner (C-83 Stage A): mine + gate a repo's history into a coding
 * suite JSON. This SHELLS git + pnpm + vitest against `--repo` and mutates
 * `--workdir` (checks out commits, installs, runs tests), so point it at a clone
 * you don't mind resetting. Run with:
 *   tsx packages/cli/src/eval/generate-coding-suite.ts \
 *     --repo <path> --workdir <path> --out <json> [--window 270] [--cap 25] [--runs 3]
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function main(): void {
  const repo = arg("repo");
  if (!repo) {
    process.stderr.write("error: --repo <path> is required\n");
    process.exit(1);
  }
  const out = arg("out");
  const suite = generateCodingSuite(repo, {
    ref: arg("ref"),
    workdir: arg("workdir"),
    windowDays: numArg("window"),
    cap: numArg("cap"),
    gateRuns: numArg("runs"),
    maxSourceFiles: numArg("max-source-files"),
    maxChangedLoc: numArg("max-loc"),
  });
  const json = JSON.stringify(suite, null, 2);
  if (out) writeFileSync(out, json + "\n");
  process.stderr.write(
    `suite: ${suite.counts.total} tasks | funnel ${JSON.stringify(suite.funnel)} | byStratum ${JSON.stringify(suite.counts.byStratum)}\n`,
  );
  if (!out) process.stdout.write(json + "\n");
}

function numArg(name: string): number | undefined {
  const v = arg(name);
  return v === undefined ? undefined : Number(v);
}

main();
