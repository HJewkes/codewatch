import type { GraphNode, NodeRole } from "./types.js";

const TEST_RE = /(?:^|\/)(?:__tests__\/|tests?\/)|\.(?:test|spec)(?:\.[a-z]+)?$/;
const FIXTURE_RE = /(?:^|\/)fixtures(?:\/|$)/;
// One-off tooling under scripts/ or dormant archive/ dirs: report noise, not
// product signal. Test-ness wins (checked first) since it's more meaningful.
const SCRIPT_RE = /(?:^|\/)(?:scripts|archive)(?:\/|$)/;
const BARREL_RE = /(?:^|\/)index(?:\.[a-z]+)?$/;
const TYPES_RE = /(?:^|\/)(?:[a-z][\w-]*\.)?types(?:\.[a-z]+)?$/i;
const CONFIG_RE = /\.config(?:\.[a-z]+)?$/;

export const ALL_ROLES: readonly NodeRole[] = [
  "test",
  "fixture",
  "barrel",
  "types",
  "config",
  "script",
  "source",
];

export function classifyRole(id: string): NodeRole {
  if (TEST_RE.test(id)) return "test";
  if (FIXTURE_RE.test(id)) return "fixture";
  if (SCRIPT_RE.test(id)) return "script";
  if (BARREL_RE.test(id)) return "barrel";
  if (TYPES_RE.test(id)) return "types";
  if (CONFIG_RE.test(id)) return "config";
  return "source";
}

export function annotateRoles(nodes: readonly GraphNode[]): GraphNode[] {
  return nodes.map((n) =>
    n.kind === "file" || n.kind === "module"
      ? { ...n, role: n.role ?? classifyRole(n.id) }
      : n,
  );
}
