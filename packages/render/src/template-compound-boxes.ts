import type { LayoutResult } from "./types.js";
import type { GroupOf } from "./layout.js";
import type { CytoscapeNodeData } from "./template-cy-data.js";

// The compound "parent" boxes the dependency graph nests nodes inside: package
// boxes for the file graph, plus subdirectory boxes for the nested drill-down
// view (C-56). Kept separate from the per-node/edge assembly so both files stay
// small and single-purpose.

export const EXTERNAL_PARENT_ID = "pkg:external";

// The package a file belongs to. In a `packages/<name>/…` monorepo the package
// is the second segment (every file's first segment is just `packages`), so nest
// files into per-package boxes rather than one giant `packages` box. Mirrors the
// client's `pkgOfId` so compound parents and package colors agree.
function packageFromInternalId(id: string): string | undefined {
  const monorepo = /^packages\/([^/]+)/.exec(id);
  const seg = monorepo ? monorepo[1] : id.split("/")[0];
  return seg ? `pkg:${seg}` : undefined;
}

export function packageIdFor(node: { id: string; kind: string }): string | undefined {
  if (node.kind === "external") return EXTERNAL_PARENT_ID;
  if (node.kind === "package") return undefined;
  return packageFromInternalId(node.id);
}

function packageLabelFor(pkgId: string): string {
  if (pkgId === EXTERNAL_PARENT_ID) return "external deps";
  return pkgId.replace(/^pkg:/, "");
}

function packageEntry(pkg: string): { data: CytoscapeNodeData } {
  // Width/height are hints for non-compound layout; cytoscape sizes compound
  // parents by their children's bounding box regardless.
  return {
    data: {
      id: pkg,
      label: packageLabelFor(pkg),
      kind: "package",
      tooltip: pkg,
      status: "unchanged",
      width: 180,
      height: 48,
      raw: { id: pkg, kind: "package", name: packageLabelFor(pkg) },
    },
  };
}

export function synthesizePackageEntries(
  layout: LayoutResult,
): Array<{ data: CytoscapeNodeData }> {
  const seen = new Set<string>();
  const out: Array<{ data: CytoscapeNodeData }> = [];
  layout.nodes.forEach((n) => {
    const pkg = packageIdFor(n);
    if (!pkg || seen.has(pkg)) return;
    seen.add(pkg);
    out.push(packageEntry(pkg));
  });
  return out;
}

// Label a compound box: packages strip the `pkg:` prefix; subdirectory boxes
// (the nested drill-down view) show just their leaf directory name.
function boxLabelFor(id: string): string {
  if (id.startsWith("dir:")) {
    const path = id.slice("dir:".length);
    return path.split("/").pop() ?? path;
  }
  return packageLabelFor(id);
}

function boxEntry(id: string, parent: string | undefined): { data: CytoscapeNodeData } {
  const label = boxLabelFor(id);
  return {
    data: {
      id,
      label,
      kind: "package",
      ...(parent ? { parent } : {}),
      tooltip: id.replace(/^(pkg|dir):/, ""),
      status: "unchanged",
      width: 180,
      height: 48,
      raw: { id, kind: "package", name: label },
    },
  };
}

// Synthesize every compound box a grouping implies (package boxes and, for the
// nested view, the subdirectory boxes inside them), each linked to its own
// parent box so cytoscape draws the boxes nested. Each group id sits under a
// single parent (the grouping is a tree), so first-seen wins.
export function synthesizeGroupBoxes(
  layout: LayoutResult,
  groupOf: GroupOf,
): Array<{ data: CytoscapeNodeData }> {
  const parentOf = new Map<string, string | undefined>();
  for (const n of layout.nodes) {
    const chain = groupOf(n);
    chain.forEach((id, i) => {
      if (!parentOf.has(id)) parentOf.set(id, i === 0 ? undefined : chain[i - 1]);
    });
  }
  return [...parentOf].map(([id, parent]) => boxEntry(id, parent));
}
