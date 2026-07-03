import type { LayoutResult, RenderInput } from "./types.js";

export const KIND_COLORS: Record<string, string> = {
  file: "#4a6da7",
  module: "#6b5b95",
  package: "#b58860",
  symbol: "#87a96b",
  external: "#d97757",
};

export const KIND_LABELS: Record<string, string> = {
  file: "File",
  module: "Module",
  package: "Package",
  symbol: "Symbol",
  external: "External",
};

const STATUS_COLORS: Record<string, string> = {
  added: "#22c55e",
  removed: "#ef4444",
  renamed: "#06b6d4",
  unchanged: "#5a6573",
};

const STATUS_LABELS: Record<string, string> = {
  added: "Added",
  removed: "Removed",
  renamed: "Renamed",
  unchanged: "Unchanged",
};

export const ROLE_COLORS: Record<string, string> = {
  test: "#7e76c2",
  fixture: "#9077a8",
  barrel: "#7c8794",
  types: "#3a8794",
  config: "#a08660",
  source: "#4a6da7",
};

export const ROLE_LABELS: Record<string, string> = {
  test: "Test",
  fixture: "Fixture",
  barrel: "Barrel",
  types: "Types",
  config: "Config",
  source: "Source",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function chipButton(opts: {
  cls: string;
  attr: string;
  attrValue: string;
  swatchHtml: string;
  accent: string;
  label: string;
  count: number;
}): string {
  return (
    `<button type="button" class="chip ${opts.cls} active" ` +
    `${opts.attr}="${escapeHtml(opts.attrValue)}" data-accent ` +
    `style="--chip-accent:${opts.accent}">` +
    opts.swatchHtml +
    `<span class="name">${escapeHtml(opts.label)}</span>` +
    `<span class="count">${opts.count}</span>` +
    `</button>`
  );
}

function nodeKindChip(kind: string, count: number): string {
  const color = KIND_COLORS[kind] ?? "#5eead4";
  return chipButton({
    cls: "node-chip",
    attr: "data-kind",
    attrValue: kind,
    swatchHtml: `<i style="background:${color}"></i>`,
    accent: color,
    label: KIND_LABELS[kind] ?? kind,
    count,
  });
}

function edgeKindChip(kind: string, count: number): string {
  const swatchHtml =
    kind === "re-exports"
      ? `<i style="background:repeating-linear-gradient(90deg,#8a96a6 0 3px,transparent 3px 6px)"></i>`
      : `<i style="background:#8a96a6"></i>`;
  return chipButton({
    cls: "edge-chip",
    attr: "data-edge-kind",
    attrValue: kind,
    swatchHtml,
    accent: "#8a96a6",
    label: kind,
    count,
  });
}

function statusChip(status: string, count: number): string {
  const color = STATUS_COLORS[status] ?? "#5eead4";
  return chipButton({
    cls: "status-chip",
    attr: "data-status",
    attrValue: status,
    swatchHtml: `<i style="background:${color}"></i>`,
    accent: color,
    label: STATUS_LABELS[status] ?? status,
    count,
  });
}

function roleChip(role: string, count: number): string {
  const color = ROLE_COLORS[role] ?? "#5eead4";
  return chipButton({
    cls: "role-chip",
    attr: "data-role",
    attrValue: role,
    swatchHtml: `<i style="background:${color}"></i>`,
    accent: color,
    label: ROLE_LABELS[role] ?? role,
    count,
  });
}

function statusGroupHtml(diff: RenderInput["diff"], layout: LayoutResult): string {
  if (!diff) return "";
  const counts: Record<string, number> = {
    added: 0,
    removed: 0,
    renamed: 0,
    unchanged: 0,
  };
  for (const n of layout.nodes) {
    const s = diff.nodeStatus[n.id] ?? "unchanged";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const chips = ["added", "removed", "renamed", "unchanged"]
    .filter((s) => counts[s]! > 0)
    .map((s) => statusChip(s, counts[s]!))
    .join("");
  return `<div class="group" aria-label="Diff status"><span class="group-label">Status</span>${chips}</div>`;
}

function violationGroupHtml(checkResult: RenderInput["checkResult"]): string {
  if (!checkResult || checkResult.violations.length === 0) return "";
  const counts = new Map<string, number>();
  for (const v of checkResult.violations) {
    counts.set(v.ruleId, (counts.get(v.ruleId) ?? 0) + 1);
  }
  const items = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ruleId, count]) =>
      chipButton({
        cls: "violation-chip",
        attr: "data-rule",
        attrValue: ruleId,
        swatchHtml: `<i style="background:#ef4444"></i>`,
        accent: "#ef4444",
        label: ruleId,
        count,
      }),
    )
    .join("");
  return `<div class="group" aria-label="Violations"><span class="group-label">Violations</span>${items}</div>`;
}

function roleGroupHtml(layout: LayoutResult): string {
  const counts = new Map<string, number>();
  for (const n of layout.nodes) {
    if (!n.role) continue;
    counts.set(n.role, (counts.get(n.role) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  const items = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => roleChip(role, count))
    .join("");
  return `<div class="group" aria-label="Role"><span class="group-label">Role</span>${items}</div>`;
}

/** Chip groups for one view — regenerated client-side on view switch. */
export function chipGroupsHtml(
  layout: LayoutResult,
  diff: RenderInput["diff"],
  checkResult: RenderInput["checkResult"],
): string {
  const groupHtml = (
    label: string,
    counts: Map<string, number>,
    chip: (k: string, c: number) => string,
  ): string => {
    const items = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => chip(k, c))
      .join("");
    return `<div class="group" aria-label="${label} kinds"><span class="group-label">${label}</span>${items}</div>`;
  };
  const nodeGroup = groupHtml(
    "Node",
    countBy(layout.nodes, (n) => n.kind),
    nodeKindChip,
  );
  const edgeGroup = groupHtml(
    "Edge",
    countBy(layout.edges, (e) => e.kind),
    edgeKindChip,
  );
  return `${nodeGroup}
  ${roleGroupHtml(layout)}
  ${edgeGroup}
  ${statusGroupHtml(diff, layout)}
  ${violationGroupHtml(checkResult)}`;
}

/** Optional view selector — shown only when there is more than one baked view. */
function viewPickerHtml(views: { id: string; label: string }[] | undefined): string {
  if (!views || views.length < 2) return "";
  const opts = views
    .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.label)}</option>`)
    .join("");
  return `<div class="group view-picker-group" aria-label="View">
    <span class="group-label">View</span>
    <select id="view-picker" class="view-picker" aria-label="Select graph view">${opts}</select>
  </div>`;
}

export function toolbarHtml(
  layout: LayoutResult,
  diff: RenderInput["diff"],
  checkResult: RenderInput["checkResult"],
  views?: { id: string; label: string }[],
): string {
  return `<div class="toolbar" role="toolbar" aria-label="Graph filters">
  ${viewPickerHtml(views)}
  <div id="chip-groups" class="chip-groups">${chipGroupsHtml(layout, diff, checkResult)}</div>
  <div class="spacer"></div>
  <span class="hint" aria-hidden="true">drag to pan · scroll to zoom</span>
  <div class="zoom-group" role="group" aria-label="Zoom controls">
    <button type="button" class="btn zoom-btn" id="zoom-out" title="Zoom out ( − )" aria-label="Zoom out">−</button>
    <button type="button" class="btn zoom-btn" id="zoom-in" title="Zoom in ( + )" aria-label="Zoom in">+</button>
    <button type="button" class="btn" id="reset-view" title="Fit graph to viewport ( f / Esc )">Fit</button>
  </div>
</div>`;
}
