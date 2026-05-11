// One-shot render harness used during verification.
// Generates a 5-node fixture, writes /tmp/test-render.html, reports size + snippet.
import { writeFile, stat } from "node:fs/promises";
import { renderHtml } from "../dist/index.js";

const fixture = {
  snapshotId: 42,
  nodes: [
    { id: "packages/app/src/index.ts", kind: "file", name: "index.ts", language: "typescript", attrs: { loc: 12 } },
    { id: "packages/app/src/router.ts", kind: "file", name: "router.ts", language: "typescript", attrs: { loc: 84 } },
    { id: "packages/app/src/handler.ts", kind: "file", name: "handler.ts", language: "typescript", attrs: { loc: 36 } },
    { id: "packages/app/src/util/log.ts", kind: "file", name: "log.ts", language: "typescript", attrs: { loc: 14 } },
    { id: "npm:hono", kind: "external", name: "hono", attrs: { spec: "^4.0.0" } },
  ],
  edges: [
    { srcId: "packages/app/src/index.ts", dstId: "packages/app/src/router.ts", kind: "imports" },
    { srcId: "packages/app/src/router.ts", dstId: "packages/app/src/handler.ts", kind: "imports" },
    { srcId: "packages/app/src/handler.ts", dstId: "packages/app/src/util/log.ts", kind: "imports" },
    { srcId: "packages/app/src/index.ts", dstId: "npm:hono", kind: "imports" },
  ],
};

const out = "/tmp/test-render.html";
const html = await renderHtml(fixture, { title: "codewatch graph (fixture)", subtitle: "5 nodes · 4 edges" });
await writeFile(out, html, "utf8");
const s = await stat(out);
console.log("wrote", out);
console.log("size_bytes", s.size);
console.log("size_kb", (s.size / 1024).toFixed(1));
console.log("snippet_head:", html.slice(0, 240).replace(/\n/g, "\\n"));
console.log("contains_cytoscape_marker:", html.includes("Cytoscape Consortium"));
console.log("contains_graph_assignment:", html.includes("window.__GRAPH__"));
