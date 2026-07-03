/**
 * Client code for the multi-view dependency graph: the toolbar view-picker,
 * per-view chip regeneration, and the in-place element swap that re-runs the
 * elk-preset setup for the chosen view. Injected into the main client IIFE, so it
 * closes over that scope (`cy`, the filter-state sets, `assignPackageColors`,
 * `applyElkRouting`, `applyFills`, `bindChips`, the color/label maps, `VIEWS`…).
 * Kept in its own module so `template-script.ts` stays under the file-loc budget.
 */
export function viewSwitchingCode(): string {
  return `
  // --- Multi-view switching (only wired when __GRAPH_VIEWS__ was baked) ---
  function resetFilters() {
    hiddenNodeKinds.clear(); hiddenEdgeKinds.clear(); hiddenStatuses.clear(); hiddenRoles.clear();
    onlyRule.value = null;
  }
  // Rebuild the node/role/edge filter chips for the active view (counts differ
  // per view), then re-bind them — mirrors the server's chipGroupsHtml.
  function regenChips(graph) {
    const countBy = function (arr, key) {
      const m = {}; arr.forEach(function (x) { const k = key(x); if (k != null) m[k] = (m[k] || 0) + 1; }); return m;
    };
    const chip = function (cls, attr, val, color, label, count, swatch) {
      return '<button type="button" class="chip ' + cls + ' active" ' + attr + '="' + val +
        '" data-accent style="--chip-accent:' + color + '">' + swatch +
        '<span class="name">' + label + '</span><span class="count">' + count + '</span></button>';
    };
    const grp = function (label, inner) { return inner ? '<div class="group"><span class="group-label">' + label + '</span>' + inner + '</div>' : ''; };
    const dot = function (c) { return '<i style="background:' + c + '"></i>'; };
    const byCount = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }); };
    const nc = countBy(graph.nodes, function (n) { return n.data && n.data.kind; });
    const nodeChips = byCount(nc).map(function (k) { const c = KIND_COLORS[k] || "#5eead4"; return chip("node-chip", "data-kind", k, c, KIND_LABELS[k] || k, nc[k], dot(c)); }).join("");
    const rc = countBy(graph.nodes, function (n) { return n.data && n.data.role; });
    const roleChips = byCount(rc).map(function (r) { const c = ROLE_COLORS[r] || "#5eead4"; return chip("role-chip", "data-role", r, c, ROLE_LABELS[r] || r, rc[r], dot(c)); }).join("");
    const ec = countBy(graph.edges, function (e) { return e.data && e.data.kind; });
    const edgeChips = byCount(ec).map(function (k) {
      const sw = k === "re-exports" ? '<i style="background:repeating-linear-gradient(90deg,#8a96a6 0 3px,transparent 3px 6px)"></i>' : dot("#8a96a6");
      return chip("edge-chip", "data-edge-kind", k, "#8a96a6", k, ec[k], sw);
    }).join("");
    const container = document.getElementById("chip-groups");
    if (container) { container.innerHTML = grp("Node", nodeChips) + grp("Role", roleChips) + grp("Edge", edgeChips); bindChips(); }
  }
  // Swap the whole element set to another baked view, re-running the same
  // elk-preset setup (colors → layout → routing → fills) the initial load does.
  function switchView(graph) {
    const anyCompound2 = graph.nodes.some(function (n) { return n.data && n.data.parent; });
    const anyPositioned2 = graph.nodes.some(function (n) { return n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y); });
    const preset = anyPositioned2 && !anyCompound2;
    if (preset) assignPackageColors(graph);
    cy.batch(function () { cy.elements().remove(); cy.add({ nodes: graph.nodes, edges: graph.edges }); });
    cy.layout(preset ? { name: "preset", fit: true, padding: 30 } : (hasCoseBilkent ? coseBilkentLayout : { name: "preset", fit: true, padding: 30 })).run();
    if (preset) applyElkRouting();
    applyFills();
    window.__layoutMode = preset ? "elk-preset" : (hasCoseBilkent ? "cose-bilkent" : "preset");
    resetFilters();
    regenChips(graph);
    cy.elements().unselect(); clearHighlights(); showEmpty();
    if (search) search.value = "";
    updateCounts();
    cy.fit(undefined, 50);
  }
  function updateCounts() {
    const txt = cy.nodes().length + " nodes · " + cy.edges().length + " edges";
    const st = document.querySelector("header .subtitle"); if (st) st.textContent = txt;
    const ft = document.querySelector("footer"); if (ft) ft.textContent = txt + " · rendered with cytoscape.js";
  }
  if (VIEWS) {
    const byId = {}; VIEWS.forEach(function (v) { byId[v.id] = v.graph; });
    const picker = document.getElementById("view-picker");
    const barrelToggle = document.getElementById("barrel-toggle");
    // The picker only lists base views; a "::resolved" variant (if baked) is
    // reached by the "See through barrels" toggle, not a separate menu entry.
    function apply() {
      const base = picker ? picker.value : (VIEWS[0] && VIEWS[0].id);
      const resolvedId = base + "::resolved";
      const wantResolved = barrelToggle ? barrelToggle.checked : false;
      const id = (wantResolved && byId[resolvedId]) ? resolvedId : base;
      const g = byId[id]; if (g) switchView(g);
    }
    if (picker) picker.addEventListener("change", apply);
    if (barrelToggle) barrelToggle.addEventListener("change", apply);
    if (barrelToggle) apply(); // sync initial render to the toggle's default state
  }
`;
}
