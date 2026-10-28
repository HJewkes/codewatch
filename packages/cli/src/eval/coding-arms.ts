import { injectPrompt, type Injection } from "./coding-inject.js";

/**
 * C-93 S5: the coding-bench arms and the `claude -p` argv each one runs with. Pure: no I/O.
 * Every arm gets the same navigation and edit tools and none gets a shell, so arms differ only in
 * codewatch's surface: A2 adds the `graph mcp` tools, AI adds a prepended context block.
 */

export type ArmId = "A0" | "A2" | "AI";

export interface ArmSpec {
  id: ArmId;
  allowedTools: readonly string[];
  disallowedTools: readonly string[];
  /** Runs with the codewatch `graph mcp` server. */
  usesMcp: boolean;
  /** Gets the codewatch context block ahead of the problem statement. */
  injectsContext: boolean;
}

export interface ClaudeArgOptions {
  model: string;
  maxTurns: number;
  workdir: string;
  /** Required for an MCP arm; never passed to the others. */
  mcpConfigPath?: string;
}

const GREP_ONLY_TOOLS = ["Grep", "Glob", "Read", "Edit", "Write"] as const;
const DENIED_TOOLS = ["Bash", "Task", "WebFetch", "WebSearch", "NotebookEdit"] as const;
const CODEWATCH_TOOLS = [
  "mcp__codewatch__get_context",
  "mcp__codewatch__get_source",
  "mcp__codewatch__get_neighbors",
  "mcp__codewatch__search",
] as const;

const ARMS: Record<ArmId, ArmSpec> = {
  A0: { id: "A0", allowedTools: GREP_ONLY_TOOLS, disallowedTools: DENIED_TOOLS, usesMcp: false, injectsContext: false },
  A2: {
    id: "A2",
    allowedTools: [...GREP_ONLY_TOOLS, ...CODEWATCH_TOOLS],
    disallowedTools: DENIED_TOOLS,
    usesMcp: true,
    injectsContext: false,
  },
  AI: { id: "AI", allowedTools: GREP_ONLY_TOOLS, disallowedTools: DENIED_TOOLS, usesMcp: false, injectsContext: true },
};

const UNPORTED_ARMS: ReadonlySet<string> = new Set(["A1", "A3"]);

export function armSpec(id: string): ArmSpec {
  if (UNPORTED_ARMS.has(id)) throw new Error(`arm ${id} is not implemented in the committed runner, see C-83`);
  if (!Object.hasOwn(ARMS, id)) throw new Error(`unknown arm: ${id} (expected A0, A2 or AI)`);
  return ARMS[id as ArmId];
}

/**
 * `--strict-mcp-config` keeps the operator's own MCP servers out of every arm, so A0 and AI
 * really run with no MCP and A2 runs with codewatch alone.
 */
export function buildClaudeArgs(spec: ArmSpec, opts: ClaudeArgOptions): string[] {
  if (spec.usesMcp && !opts.mcpConfigPath) throw new Error(`arm ${spec.id} needs an MCP config path`);
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", opts.model,
    "--permission-mode", "bypassPermissions",
    "--max-turns", String(opts.maxTurns),
    "--allowed-tools", spec.allowedTools.join(","),
    "--disallowed-tools", spec.disallowedTools.join(","),
    "--add-dir", opts.workdir,
    "--strict-mcp-config",
  ];
  return spec.usesMcp ? [...args, "--mcp-config", opts.mcpConfigPath!] : args;
}

export interface CodewatchMcpOptions {
  cliPath: string;
  dbPath: string;
  repoRoot: string;
  /** Load the tools inline instead of deferred; the C-83 v3 setting, off by owner steer. */
  alwaysLoad?: boolean;
}

export interface CodewatchMcpConfig {
  mcpServers: { codewatch: { command: string; args: string[]; alwaysLoad?: boolean } };
}

export function codewatchMcpConfig(opts: CodewatchMcpOptions): CodewatchMcpConfig {
  const server = {
    command: "node",
    args: [opts.cliPath, "graph", "mcp", "--db", opts.dbPath, "--repo-root", opts.repoRoot],
  };
  return { mcpServers: { codewatch: opts.alwaysLoad ? { ...server, alwaysLoad: true } : server } };
}

const PROMPT_SUFFIX = [
  "",
  "Constraints:",
  "- You have NO shell/test-runner: you cannot run the tests. Locate and fix the",
  "  bug by reading the code with the tools you have, then reason about the fix.",
  "- Edit only source files; do NOT modify any *.test.* / *.spec.* files.",
  "- When you believe the failing tests will pass, stop.",
].join("\n");

/** The arm's stdin prompt; only an injecting arm sees the context block. */
export function armPrompt(spec: ArmSpec, problemStatement: string, injection: Injection): string {
  const statement = spec.injectsContext ? injectPrompt(problemStatement, injection) : problemStatement;
  return `${statement}${PROMPT_SUFFIX}`;
}
