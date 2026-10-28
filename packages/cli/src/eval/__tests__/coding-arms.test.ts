import { describe, it, expect } from "vitest";
import { armPrompt, armSpec, buildClaudeArgs, codewatchMcpConfig } from "../coding-arms.js";

const OPTS = { model: "sonnet", maxTurns: 30, workdir: "/work/repo", mcpConfigPath: "/work/mcp.json" };

function flagValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("coding-bench arm specs", () => {
  it("gives the injected arm exactly the grep-only tool set and no MCP config", () => {
    const baseline = armSpec("A0");
    const injected = armSpec("AI");

    const args = buildClaudeArgs(injected, OPTS);

    expect(injected.allowedTools).toEqual(baseline.allowedTools);
    expect(injected.disallowedTools).toEqual(baseline.disallowedTools);
    expect(flagValue(args, "--allowed-tools")).toBe("Grep,Glob,Read,Edit,Write");
    expect(args).not.toContain("--mcp-config");
    expect(args).toContain("--strict-mcp-config");
  });

  it("denies Bash and Task in every arm", () => {
    for (const id of ["A0", "A2", "AI"]) {
      const args = buildClaudeArgs(armSpec(id), OPTS);

      const denied = flagValue(args, "--disallowed-tools")?.split(",");

      expect(denied).toEqual(expect.arrayContaining(["Bash", "Task"]));
      expect(flagValue(args, "--allowed-tools")).not.toMatch(/Bash|Task/);
    }
  });

  it("passes the codewatch MCP config only to the MCP arm", () => {
    const args = buildClaudeArgs(armSpec("A2"), OPTS);

    expect(flagValue(args, "--mcp-config")).toBe("/work/mcp.json");
    expect(flagValue(args, "--allowed-tools")).toContain("mcp__codewatch__get_context");
  });

  it("refuses to build the MCP arm without a config path", () => {
    const { mcpConfigPath: _omitted, ...noConfig } = OPTS;

    expect(() => buildClaudeArgs(armSpec("A2"), noConfig)).toThrow(/mcp config/i);
  });

  it("rejects the unported arms with a pointer to C-83", () => {
    expect(() => armSpec("A1")).toThrow(/not implemented.*C-83/);
    expect(() => armSpec("A3")).toThrow(/not implemented.*C-83/);
    expect(() => armSpec("B9")).toThrow(/unknown arm/);
  });

  it("keeps the codewatch server deferred unless asked to load it inline", () => {
    const deferred = codewatchMcpConfig({ cliPath: "/cli.js", dbPath: "/idx.db", repoRoot: "/work/repo" });
    const inline = codewatchMcpConfig({ cliPath: "/cli.js", dbPath: "/idx.db", repoRoot: "/work/repo", alwaysLoad: true });

    expect(deferred.mcpServers.codewatch).not.toHaveProperty("alwaysLoad");
    expect(inline.mcpServers.codewatch.alwaysLoad).toBe(true);
    expect(inline.mcpServers.codewatch.args).toEqual(["/cli.js", "graph", "mcp", "--db", "/idx.db", "--repo-root", "/work/repo"]);
  });

  it("prepends the injected block to the injected arm's prompt only", () => {
    const injection = { text: "CONTEXT", citations: [], estimatedTokens: 2 };

    const injected = armPrompt(armSpec("AI"), "Fix the bug.", injection);
    const baseline = armPrompt(armSpec("A0"), "Fix the bug.", injection);

    expect(injected.startsWith("CONTEXT\n\nFix the bug.")).toBe(true);
    expect(baseline.startsWith("Fix the bug.")).toBe(true);
    expect(baseline).not.toContain("CONTEXT");
    expect(baseline).toContain("do NOT modify any *.test.*");
  });
});
