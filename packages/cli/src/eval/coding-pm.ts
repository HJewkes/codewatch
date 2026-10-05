/**
 * Package-manager selection for the admission gate. Which install and test
 * commands a candidate needs follows from the lockfiles present at its parent
 * commit, so a repo gates with no repo-specific code path. Pure: the caller
 * reads the lockfiles from git and shells the argv it gets back.
 */

/** Root lockfiles the gate recognises, in precedence order. */
export const KNOWN_LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"] as const;

export type PackageManager = "pnpm" | "npm";

export interface RepoCommands {
  manager: PackageManager;
  install: readonly string[];
  /** Test argv prefix; the gate appends the test files. Must print a vitest JSON report. */
  test: readonly string[];
}

const VITEST_JSON = ["vitest", "run", "--reporter=json", "--no-color"];

// `--ignore-scripts`: the tests run against source through the repo's vitest
// alias map, so build and postinstall scripts only add flakiness (network
// fetches) and time.
const DEFAULTS: Record<PackageManager, Omit<RepoCommands, "manager">> = {
  pnpm: {
    install: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
    test: ["pnpm", "exec", ...VITEST_JSON],
  },
  npm: {
    install: ["npm", "ci", "--ignore-scripts"],
    test: ["npm", "exec", "--no", "--", ...VITEST_JSON],
  },
};

/** The default pnpm test argv, used when no commands were selected. */
export const PNPM_TEST_COMMAND = DEFAULTS.pnpm.test;

/**
 * Pick install and test argv from the lockfiles at the parent commit. A
 * per-repo `testOverride` replaces the default test argv. Throws when no
 * supported lockfile is present: yarn's install flags differ between major
 * versions, so a yarn-only repo is rejected rather than guessed at.
 */
export function selectRepoCommands(
  lockfiles: readonly string[],
  testOverride?: readonly string[],
): RepoCommands {
  const manager = managerFor(lockfiles);
  const defaults = DEFAULTS[manager];
  const test = testOverride && testOverride.length > 0 ? testOverride : defaults.test;
  return { manager, install: defaults.install, test };
}

function managerFor(lockfiles: readonly string[]): PackageManager {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("package-lock.json")) return "npm";
  if (lockfiles.includes("yarn.lock")) {
    throw new Error("yarn.lock is not supported by the gate: add a pnpm or npm lockfile");
  }
  throw new Error("no lockfile at the parent commit: the gate needs pnpm-lock.yaml or package-lock.json");
}

/**
 * Split a `--test-command` value into argv on whitespace. There is no shell, so
 * a quoted value is rejected rather than split into arguments that keep their quotes.
 */
export function parseTestCommand(value: string | undefined): string[] | undefined {
  if (value && /["'`]/.test(value)) {
    throw new Error(`--test-command is split on whitespace with no shell, so quotes are not supported: ${value}`);
  }
  const argv = value?.split(/\s+/).filter(Boolean) ?? [];
  return argv.length > 0 ? argv : undefined;
}
