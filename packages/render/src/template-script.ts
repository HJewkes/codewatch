import { cyStyles } from "./template-cy-styles.js";

export function clientScript(kindColors: Record<string, string>): string {
  return `
(function () {
  const data = window.__GRAPH__;
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: { nodes: data.nodes, edges: data.edges },
    layout: { name: "preset" },
    minZoom: 0.1,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    style: ${cyStyles()}
  });
  const KIND_FILL = ${JSON.stringify(kindColors)};
  cy.nodes().forEach(function (n) {
    const overlay = n.data("overlay_fill");
    n.data("fill", overlay || KIND_FILL[n.data("kind")] || "#4a6da7");
  });
  cy.ready(function () { cy.fit(undefined, 50); });

  const panel = document.getElementById("panel");
  const hiddenNodeKinds = new Set();
  const hiddenEdgeKinds = new Set();
  const hiddenStatuses = new Set();
  const hiddenRoles = new Set();
  const STATUS_BADGE = {
    added: { color: "#22c55e", label: "added" },
    removed: { color: "#ef4444", label: "removed" },
    renamed: { color: "#06b6d4", label: "renamed" },
    unchanged: { color: "#5a6573", label: "unchanged" }
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderRow(k, v, cls) {
    const vClass = cls ? ' class="v ' + cls + '"' : ' class="v"';
    return '<div class="row"><div class="k">' + k + '</div><div' + vClass + '>' + v + '</div></div>';
  }
  function showEmpty() {
    panel.innerHTML = '<h2>Selection</h2><div class="empty">Click a node to see details.</div>';
  }
  function neighborsOf(nodeId) {
    const inbound = [];
    const outbound = [];
    cy.edges().forEach(function (e) {
      if (e.data("target") === nodeId) inbound.push(e.data("source"));
      if (e.data("source") === nodeId) outbound.push(e.data("target"));
    });
    return { inbound: inbound, outbound: outbound };
  }
  function neighborListHtml(ids, dataAttr) {
    if (!ids.length) return '';
    const top = ids.slice(0, 5);
    return '<ul class="neighbors">' + top.map(function (id) {
      return '<li ' + dataAttr + '="' + escapeHtml(id) + '">' + escapeHtml(id) + '</li>';
    }).join('') + '</ul>';
  }
  function attrsBlock(attrs) {
    if (!attrs || !Object.keys(attrs).length) return '';
    return '<h2 style="margin-top:14px">Attributes</h2><pre>' +
      escapeHtml(JSON.stringify(attrs, null, 2)) + '</pre>';
  }
  function statusBadge(status) {
    if (!status || status === "unchanged") return "";
    const meta = STATUS_BADGE[status] || STATUS_BADGE.unchanged;
    return '<span class="badge" style="background:' + meta.color + '22;color:' + meta.color + ';border-color:' + meta.color + '55">' +
      escapeHtml(meta.label) + '</span>';
  }
  function fmtNum(v) {
    if (v === null || v === undefined) return '—';
    if (Number.isInteger(v)) return String(v);
    return Number(v).toFixed(3).replace(/\\.?0+$/, '');
  }
  function fmtDelta(after, before) {
    if (before === undefined || before === null) return '';
    if (after === undefined || after === null) return '';
    const d = after - before;
    if (d === 0) return '';
    const cls = d > 0 ? 'delta-up' : 'delta-down';
    const sign = d > 0 ? '+' : '';
    return ' <span class="' + cls + '">(' + sign + fmtNum(d) + ')</span>';
  }
  function metricsBlock(metrics, before) {
    if (!metrics || Object.keys(metrics).length === 0) return '';
    const order = ['loc','function_count','cyclomatic_max','cyclomatic_sum','max_nesting_depth','fan_in','fan_out','instability'];
    const seen = new Set();
    const rows = [];
    function pushRow(name) {
      if (seen.has(name)) return;
      seen.add(name);
      const v = metrics[name];
      if (v === undefined) return;
      const b = before ? before[name] : undefined;
      rows.push('<div class="row"><div class="k">' + escapeHtml(name) + '</div>' +
        '<div class="v num">' + fmtNum(v) + fmtDelta(v, b) + '</div></div>');
    }
    for (const n of order) pushRow(n);
    for (const k of Object.keys(metrics)) pushRow(k);
    if (rows.length === 0) return '';
    return '<h2 style="margin-top:14px">Metrics</h2>' + rows.join('');
  }
  function showNode(raw) {
    const nb = neighborsOf(raw.id);
    panel.innerHTML =
      '<h2>Node ' + statusBadge(raw.status) + '</h2>' +
      '<div class="node-id">' + escapeHtml(raw.id) + '</div>' +
      (raw.oldId ? renderRow("was", escapeHtml(raw.oldId)) : "") +
      renderRow("kind", escapeHtml(raw.kind)) +
      (raw.role ? renderRow("role", escapeHtml(raw.role)) : "") +
      (raw.language ? renderRow("language", escapeHtml(raw.language)) : "") +
      (raw.name ? renderRow("name", escapeHtml(raw.name)) : "") +
      (raw.parentId ? renderRow("parent", escapeHtml(raw.parentId)) : "") +
      renderRow("Fan-in", String(nb.inbound.length), "num") +
      renderRow("Fan-out", String(nb.outbound.length), "num") +
      '<div class="actions"><a data-action="show-neighbors">Show neighbors</a></div>' +
      (nb.inbound.length ? '<h2 style="margin-top:14px">Top inbound</h2>' +
        neighborListHtml(nb.inbound, 'data-neighbor') : '') +
      (nb.outbound.length ? '<h2 style="margin-top:14px">Top outbound</h2>' +
        neighborListHtml(nb.outbound, 'data-neighbor') : '') +
      metricsBlock(raw.metrics, raw.metricsBefore) +
      attrsBlock(raw.attrs);
  }
  showEmpty();

  function clearHighlights() {
    cy.elements().removeClass("highlight").removeClass("faded");
  }
  function highlightNeighborhood(node) {
    const neighborhood = node.closedNeighborhood();
    cy.elements().not(neighborhood).addClass("faded");
    neighborhood.removeClass("faded");
    neighborhood.addClass("highlight");
  }
  function selectNodeById(id) {
    const n = cy.getElementById(id);
    if (!n || n.empty()) return;
    cy.elements().unselect();
    n.select();
    showNode(n.data("raw"));
    clearHighlights();
    highlightNeighborhood(n);
    cy.animate({ center: { eles: n }, duration: 220 });
  }

  cy.on("tap", "node", function (evt) {
    const n = evt.target;
    showNode(n.data("raw"));
    clearHighlights();
    highlightNeighborhood(n);
  });
  cy.on("tap", function (evt) {
    if (evt.target === cy) {
      cy.elements().unselect();
      clearHighlights();
      showEmpty();
    }
  });
  panel.addEventListener("click", function (evt) {
    const t = evt.target;
    if (t && t.getAttribute("data-action") === "show-neighbors") {
      const sel = cy.$("node:selected");
      if (sel.length) highlightNeighborhood(sel);
      return;
    }
    const nid = t && t.getAttribute && t.getAttribute("data-neighbor");
    if (nid) selectNodeById(nid);
  });

  function applyKindVisibility() {
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        const role = n.data("role");
        const hidden =
          hiddenNodeKinds.has(n.data("kind")) ||
          hiddenStatuses.has(n.data("status")) ||
          (role && hiddenRoles.has(role));
        if (hidden) n.addClass("kind-hidden");
        else n.removeClass("kind-hidden");
      });
      cy.edges().forEach(function (e) {
        const hidden =
          hiddenEdgeKinds.has(e.data("kind")) ||
          hiddenStatuses.has(e.data("status"));
        if (hidden) e.addClass("kind-hidden");
        else e.removeClass("kind-hidden");
      });
    });
  }
  function bindChips() {
    document.querySelectorAll(".chip.node-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const kind = chip.getAttribute("data-kind");
        if (hiddenNodeKinds.has(kind)) {
          hiddenNodeKinds.delete(kind); chip.classList.add("active"); chip.classList.remove("inactive");
        } else {
          hiddenNodeKinds.add(kind); chip.classList.remove("active"); chip.classList.add("inactive");
        }
        applyKindVisibility();
      });
    });
    document.querySelectorAll(".chip.edge-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const kind = chip.getAttribute("data-edge-kind");
        if (hiddenEdgeKinds.has(kind)) {
          hiddenEdgeKinds.delete(kind); chip.classList.add("active"); chip.classList.remove("inactive");
        } else {
          hiddenEdgeKinds.add(kind); chip.classList.remove("active"); chip.classList.add("inactive");
        }
        applyKindVisibility();
      });
    });
    document.querySelectorAll(".chip.status-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const status = chip.getAttribute("data-status");
        if (hiddenStatuses.has(status)) {
          hiddenStatuses.delete(status); chip.classList.add("active"); chip.classList.remove("inactive");
        } else {
          hiddenStatuses.add(status); chip.classList.remove("active"); chip.classList.add("inactive");
        }
        applyKindVisibility();
      });
    });
    document.querySelectorAll(".chip.role-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const role = chip.getAttribute("data-role");
        if (hiddenRoles.has(role)) {
          hiddenRoles.delete(role); chip.classList.add("active"); chip.classList.remove("inactive");
        } else {
          hiddenRoles.add(role); chip.classList.remove("active"); chip.classList.add("inactive");
        }
        applyKindVisibility();
      });
    });
  }
  bindChips();

  const resetBtn = document.getElementById("reset-view");
  resetBtn.addEventListener("click", function () {
    cy.elements().unselect();
    clearHighlights();
    showEmpty();
    cy.fit(undefined, 50);
  });
  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape") {
      cy.elements().unselect();
      clearHighlights();
      showEmpty();
      cy.fit(undefined, 50);
    }
  });

  const search = document.getElementById("search");
  search.addEventListener("input", function () {
    const q = search.value.trim().toLowerCase();
    if (!q) { clearHighlights(); return; }
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        const matches = n.data("id").toLowerCase().indexOf(q) !== -1;
        if (matches) n.removeClass("faded"); else n.addClass("faded");
      });
      cy.edges().addClass("faded");
    });
  });
})();
`;
}
