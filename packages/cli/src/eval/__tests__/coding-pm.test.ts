import { describe, it, expect } from "vitest";
import { parseTestCommand, selectRepoCommands } from "../coding-pm.js";

describe("selectRepoCommands", () => {
  it("keeps the frozen pnpm install and pnpm exec vitest for a pnpm repo", () => {
    const cmds = selectRepoCommands(["pnpm-lock.yaml"]);

    expect(cmds.manager).toBe("pnpm");
    expect(cmds.install).toEqual(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]);
    expect(cmds.test).toEqual(["pnpm", "exec", "vitest", "run", "--reporter=json", "--no-color"]);
  });

  it("uses npm ci and npm exec for a repo with only package-lock.json", () => {
    const cmds = selectRepoCommands(["package-lock.json"]);

    expect(cmds.manager).toBe("npm");
    expect(cmds.install).toEqual(["npm", "ci", "--ignore-scripts"]);
    expect(cmds.test).toEqual([
      "npm", "exec", "--no", "--", "vitest", "run", "--reporter=json", "--no-color",
    ]);
  });

  it("prefers pnpm when both lockfiles are present", () => {
    expect(selectRepoCommands(["package-lock.json", "pnpm-lock.yaml"]).manager).toBe("pnpm");
  });

  it("replaces only the test argv when a per-repo override is given", () => {
    const override = ["npx", "vitest", "run", "--reporter=json", "--project", "unit"];

    const cmds = selectRepoCommands(["package-lock.json"], override);

    expect(cmds.test).toEqual(override);
    expect(cmds.install).toEqual(["npm", "ci", "--ignore-scripts"]);
  });

  it("falls back to the default test argv for an empty override", () => {
    expect(selectRepoCommands(["pnpm-lock.yaml"], []).test[0]).toBe("pnpm");
  });

  it("rejects a parent commit with no lockfile", () => {
    expect(() => selectRepoCommands([])).toThrow(/no lockfile at the parent commit/);
  });

  it("rejects a yarn-only repo with a clear error", () => {
    expect(() => selectRepoCommands(["yarn.lock"])).toThrow(/yarn.lock is not supported/);
  });
});

describe("parseTestCommand", () => {
  it("splits a flag value into argv on whitespace", () => {
    expect(parseTestCommand("  npx  vitest run ")).toEqual(["npx", "vitest", "run"]);
  });

  it("returns undefined for a missing or blank value", () => {
    expect(parseTestCommand(undefined)).toBeUndefined();
    expect(parseTestCommand("   ")).toBeUndefined();
  });
});
