export function inlineStyles(): string {
  return `
:root {
  --bg: #0f1419;
  --bg-elev: #161c24;
  --bg-elev-2: #1f2730;
  --border: #2a333f;
  --text: #d7dee8;
  --text-dim: #8a96a6;
  --text-faint: #5a6573;
  --accent: #5eead4;
  --accent-soft: rgba(94,234,212,0.18);
  --kind-file: #4a6da7;
  --kind-module: #6b5b95;
  --kind-package: #b58860;
  --kind-symbol: #87a96b;
  --kind-external: #d97757;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  height: 100vh;
}
header {
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  display: flex;
  align-items: baseline;
  gap: 16px;
}
header h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.2px; }
header .subtitle { color: var(--text-dim); font-size: 13px; }
header .search {
  margin-left: auto;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text);
  font-size: 13px;
  width: 260px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
header .search:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.toolbar .group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.toolbar .group-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-faint);
  margin-right: 2px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev-2);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease;
}
.chip i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
  background: var(--accent);
}
.chip.edge-chip i {
  width: 14px;
  height: 2px;
  border-radius: 0;
}
.chip .count {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.chip.active {
  background: var(--bg-elev);
}
.chip.active[data-accent] {
  border-color: var(--chip-accent, var(--accent));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chip-accent, var(--accent)) 22%, transparent);
}
.chip.inactive {
  opacity: 0.45;
  color: var(--text-dim);
}
.toolbar .view-picker-group { margin-right: 4px; }
.toolbar .view-picker {
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 120ms ease;
}
.toolbar .view-picker:hover, .toolbar .view-picker:focus { border-color: var(--accent); outline: none; }
.toolbar .spacer { flex: 1; }
.toolbar button.btn {
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.toolbar button.btn:hover { border-color: var(--accent); }
.toolbar .zoom-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.toolbar .zoom-btn {
  min-width: 28px;
  padding: 4px 0;
  font-size: 16px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.toolbar .hint {
  color: var(--text-faint);
  font-size: 11px;
  letter-spacing: 0.3px;
  margin-right: 6px;
  user-select: none;
}
main {
  display: grid;
  grid-template-columns: 1fr 320px;
  min-height: 0;
}
#cy {
  width: 100%;
  height: 100%;
  background:
    radial-gradient(1200px 600px at 50% -20%, rgba(94,234,212,0.04), transparent 60%),
    var(--bg);
}
aside {
  border-left: 1px solid var(--border);
  background: var(--bg-elev);
  padding: 16px;
  overflow-y: auto;
  font-size: 13px;
}
aside h2 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-dim);
  font-weight: 600;
}
.badge {
  display: inline-block;
  padding: 1px 7px;
  margin-left: 8px;
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  border-radius: 999px;
  border: 1px solid;
  font-weight: 600;
  vertical-align: 1px;
}
header .diff-summary {
  display: inline-flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
header .diff-summary span.added { color: #22c55e; }
header .diff-summary span.removed { color: #ef4444; }
header .diff-summary span.renamed { color: #06b6d4; }
header .overlay-badge {
  display: inline-block;
  padding: 1px 8px;
  font-size: 11px;
  letter-spacing: 0.3px;
  border-radius: 4px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  margin-left: 4px;
}
aside .empty { color: var(--text-faint); font-style: italic; }
aside .node-id {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  word-break: break-all;
  margin-bottom: 6px;
}
aside .row { display: flex; gap: 6px; margin: 2px 0; }
aside .row .k { color: var(--text-dim); min-width: 72px; }
aside .row .v { color: var(--text); }
aside .row .v.num { font-variant-numeric: tabular-nums; }
aside .row .v .delta-up { color: #d95757; font-size: 11px; }
aside .row .v .delta-down { color: #5eead4; font-size: 11px; }
aside .actions {
  margin-top: 6px;
  display: flex;
  gap: 10px;
}
aside .actions a {
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  border-bottom: 1px dotted var(--accent);
}
aside .actions a:hover { color: var(--text); border-bottom-color: var(--text); }
aside ul.neighbors {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}
aside ul.neighbors li {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
  padding: 2px 0;
  color: var(--text);
  cursor: pointer;
  word-break: break-all;
}
aside ul.neighbors li:hover { color: var(--accent); }
aside pre {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11.5px;
  color: var(--text);
  overflow-x: auto;
  margin: 8px 0 0;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
footer {
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
  padding: 8px 24px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
}
`;
}
