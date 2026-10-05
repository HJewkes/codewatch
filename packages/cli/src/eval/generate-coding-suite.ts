import { writeFileSync } from "node:fs";
import { generateCodingSuite } from "./coding-generate.js";
import { screenCodingCandidates, type CodingScreen } from "./coding-screen-suite.js";
import type { CodingSuite } from "./coding-types.js";

/**
 * Standalone runner (C-83 Stage A): mine + gate a repo's history into a coding
 * suite JSON. This SHELLS git + pnpm + vitest against `--repo` and mutates
 * `--workdir` (checks out commits, installs, runs tests), so point it at a clone
 * you don't mind resetting. Run with:
 *   tsx packages/cli/src/eval/generate-coding-suite.ts \
 *     --repo <path> --workdir <path> --out <json> [--window 270] [--cap 25] [--runs 3]
 *     [--max-source-files 10] [--max-loc 500] [--min-dark 0] [--screen-only]
 * `--screen-only` stops after the hardness screen and writes the candidates; it
 * reads git only and never touches `--workdir`. The C-83 scope was
 * `--max-source-files 3 --max-loc 80`.
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
  const mining = {
    ref: arg("ref"),
    windowDays: numArg("window"),
    maxSourceFiles: numArg("max-source-files"),
    maxChangedLoc: numArg("max-loc"),
    minDark: numArg("min-dark"),
  };
  const result = process.argv.includes("--screen-only")
    ? screenCodingCandidates(repo, mining)
    : generateCodingSuite(repo, {
        ...mining,
        workdir: arg("workdir"),
        cap: numArg("cap"),
        gateRuns: numArg("runs"),
      });
  const json = JSON.stringify(result, null, 2);
  if (out) writeFileSync(out, json + "\n");
  process.stderr.write(summary(result) + "\n");
  if (!out) process.stdout.write(json + "\n");
}

function summary(result: CodingSuite | CodingScreen): string {
  const funnel = `funnel ${JSON.stringify(result.funnel)}`;
  if ("candidates" in result) return `screen: ${result.candidates.length} candidates | ${funnel}`;
  return `suite: ${result.counts.total} tasks | ${funnel} | byStratum ${JSON.stringify(result.counts.byStratum)}`;
}

function numArg(name: string): number | undefined {
  const v = arg(name);
  return v === undefined ? undefined : Number(v);
}

main();
