export function cyStyles(): string {
  return `[
    { selector: "node", style: {
      "background-color": "data(fill)",
      "shape": "round-rectangle",
      "width": "data(width)",
      "height": "data(height)",
      "label": "data(label)",
      "color": "#d7dee8",
      "font-family": "-apple-system, system-ui, sans-serif",
      "font-size": 13,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "ellipsis",
      "text-max-width": 160,
      "text-outline-color": "#0f1419",
      "text-outline-width": 1.5,
      "text-outline-opacity": 0.85,
      "border-width": 1,
      "border-color": "#2a333f",
      "transition-property": "opacity, border-color, overlay-opacity",
      "transition-duration": "120ms",
      "transition-timing-function": "ease-in-out"
    } },
    { selector: "node[kind = 'module']", style: {
      "opacity": 0.9,
      "font-size": 12
    } },
    { selector: "node[kind = 'external']", style: {
      "shape": "octagon",
      "background-color": "#d97757",
      "color": "#1a1410",
      "text-outline-color": "#1a1410",
      "text-outline-opacity": 0.4
    } },
    { selector: "node[kind = 'package']", style: {
      "shape": "round-tag"
    } },
    { selector: "node:selected", style: {
      "overlay-color": "#5eead4",
      "overlay-padding": 6,
      "overlay-opacity": 0.25
    } },
    { selector: "node[status = 'added']", style: {
      "border-color": "#22c55e",
      "border-width": 3
    } },
    { selector: "node[status = 'removed']", style: {
      "border-color": "#ef4444",
      "border-width": 3,
      "border-style": "dashed",
      "opacity": 0.55
    } },
    { selector: "node[status = 'renamed']", style: {
      "border-color": "#06b6d4",
      "border-width": 3
    } },
    { selector: "node[violation_severity = 'error']", style: {
      "overlay-color": "#ef4444",
      "overlay-padding": 6,
      "overlay-opacity": 0.32
    } },
    { selector: "node[violation_severity = 'warning']", style: {
      "overlay-color": "#f59e0b",
      "overlay-padding": 6,
      "overlay-opacity": 0.28
    } },
    { selector: "node[violation_origin = 'carryover']", style: {
      "overlay-opacity": 0.12
    } },
    { selector: "node[violation_origin = 'new']", style: {
      "overlay-padding": 8
    } },
    { selector: "node[violation_trend = 'worsened']", style: {
      "overlay-color": "#f97316",
      "overlay-padding": 8,
      "overlay-opacity": 0.32
    } },
    { selector: "node[violation_trend = 'improved']", style: {
      "overlay-color": "#3b82f6",
      "overlay-padding": 6,
      "overlay-opacity": 0.22
    } },
    { selector: "node[resolved_count > 0]", style: {
      "border-color": "#22c55e",
      "border-width": 3,
      "border-style": "double"
    } },
    { selector: ".faded", style: { "opacity": 0.15 } },
    { selector: ".kind-hidden", style: { "opacity": 0.05 } },
    { selector: ".highlight", style: {
      "overlay-color": "#5eead4",
      "overlay-padding": 5,
      "overlay-opacity": 0.18
    } },
    { selector: "edge", style: {
      "curve-style": "bezier",
      "width": 1.2,
      "line-color": "#3a4452",
      "target-arrow-color": "#3a4452",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "opacity": 0.7,
      "transition-property": "opacity, line-color, target-arrow-color, width",
      "transition-duration": "120ms"
    } },
    { selector: "edge[kind = 're-exports']", style: {
      "line-style": "dashed"
    } },
    { selector: "edge[status = 'added']", style: {
      "line-color": "#22c55e",
      "target-arrow-color": "#22c55e",
      "width": 2
    } },
    { selector: "edge[status = 'removed']", style: {
      "line-color": "#ef4444",
      "target-arrow-color": "#ef4444",
      "line-style": "dashed",
      "width": 2,
      "opacity": 0.6
    } },
    { selector: "edge.faded", style: { "opacity": 0.05 } },
    { selector: "edge.kind-hidden", style: { "opacity": 0.05 } },
    { selector: "edge.highlight", style: {
      "line-color": "#5eead4",
      "target-arrow-color": "#5eead4",
      "width": 2.2,
      "opacity": 1
    } }
  ]`;
}
