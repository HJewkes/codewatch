#!/usr/bin/env node
// Inject a CodewatchData JSON into the built single-file dashboard as
// window.__CODEWATCH__, producing a standalone HTML for that dataset.
// Usage: node scripts/inject.mjs dist/index.html data.json out.html
import { readFileSync, writeFileSync } from "node:fs";
const [html, dataPath, out] = process.argv.slice(2);
const doc = readFileSync(html, "utf8");
const data = readFileSync(dataPath, "utf8");
const safe = data.replace(/<\//g, "<\\/");
const script = `<script>window.__CODEWATCH__ = ${safe};</script>`;
writeFileSync(out, doc.replace("</head>", `${script}</head>`));
console.log(`wrote ${out}`);
