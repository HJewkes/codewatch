import { cyStyles } from "./template-cy-styles.js";
import { panelClientCode } from "./template-script-panel.js";

export function clientScript(kindColors: Record<string, string>): string {
  return `
(function () {
  const data = window.__GRAPH__;
  if (window.cytoscapeCoseBilkent && typeof cytoscape.use === "function") {
    try { cytoscape.use(window.cytoscapeCoseBilkent); } catch (e) { /* already registered */ }
  }
  const hasCoseBilkent = !!window.cytoscapeCoseBilkent;
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: { nodes: data.nodes, edges: data.edges },
    layout: hasCoseBilkent
      ? {
          name: "cose-bilkent",
          animate: false,
          fit: true,
          padding: 30,
          randomize: true,
          nodeRepulsion: 6500,
          idealEdgeLength: 90,
          edgeElasticity: 0.45,
          gravity: 0.25,
          gravityRangeCompound: 1.5,
          gravityCompound: 1.0,
          numIter: 2500,
          tile: true,
          tilingPaddingVertical: 12,
          tilingPaddingHorizontal: 12,
        }
      : { name: "preset" },
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

  const hiddenNodeKinds = new Set();
  const hiddenEdgeKinds = new Set();
  const hiddenStatuses = new Set();
  const hiddenRoles = new Set();
  const onlyRule = { value: null };  // null=show all, string=show only nodes violating this rule
  ${panelClientCode()}
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

  function nodeViolatesRule(n, ruleId) {
    const violations = (n.data("raw") || {}).violations;
    if (!violations) return false;
    return violations.some(function (v) { return v.ruleId === ruleId; });
  }
  function applyKindVisibility() {
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        const role = n.data("role");
        const ruleFilter = onlyRule.value;
        const failsRuleFilter = ruleFilter && !nodeViolatesRule(n, ruleFilter);
        const hidden =
          hiddenNodeKinds.has(n.data("kind")) ||
          hiddenStatuses.has(n.data("status")) ||
          (role && hiddenRoles.has(role)) ||
          failsRuleFilter;
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
    const violationChips = document.querySelectorAll(".chip.violation-chip");
    violationChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        const rule = chip.getAttribute("data-rule");
        if (onlyRule.value === rule) {
          onlyRule.value = null;
          violationChips.forEach(function (c) { c.classList.add("active"); c.classList.remove("inactive"); });
        } else {
          onlyRule.value = rule;
          violationChips.forEach(function (c) {
            if (c === chip) { c.classList.add("active"); c.classList.remove("inactive"); }
            else { c.classList.remove("active"); c.classList.add("inactive"); }
          });
        }
        applyKindVisibility();
      });
    });
  }
  bindChips();

  const ZOOM_STEP = 1.25;
  function fitToViewport() {
    cy.elements().unselect();
    clearHighlights();
    showEmpty();
    cy.fit(undefined, 50);
  }
  function zoomBy(factor) {
    const next = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
    cy.animate({ zoom: { level: next, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }, duration: 120 });
  }
  document.getElementById("reset-view").addEventListener("click", fitToViewport);
  document.getElementById("zoom-in").addEventListener("click", function () { zoomBy(ZOOM_STEP); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoomBy(1 / ZOOM_STEP); });

  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
  }
  document.addEventListener("keydown", function (evt) {
    if (isTypingTarget(evt.target)) return;
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    if (evt.key === "Escape" || evt.key === "f" || evt.key === "F") {
      fitToViewport();
      evt.preventDefault();
    } else if (evt.key === "+" || evt.key === "=") {
      zoomBy(ZOOM_STEP);
      evt.preventDefault();
    } else if (evt.key === "-" || evt.key === "_") {
      zoomBy(1 / ZOOM_STEP);
      evt.preventDefault();
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
