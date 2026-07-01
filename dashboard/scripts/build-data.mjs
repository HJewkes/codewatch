#!/usr/bin/env node
// Map `graph report --json` (optionally + a `graph check` text dump) into the
// dashboard's CodewatchData contract. This is the seed of a future
// `graph dashboard` CLI command.
//
// Usage: node scripts/build-data.mjs --report report.json --out data.json
//        [--check check.txt] [--repo NAME] [--authors N] [--vs REF:SNAP]
import { readFileSync, writeFileSync } from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const report = JSON.parse(readFileSync(arg("report"), "utf8"));
const checkText = arg("check") ? readFileSync(arg("check"), "utf8") : "";

// Parse violation lines like:
//   CARRY ERROR  packages/graph/src/indexer.ts  churn_30d=... = 5035 > 3000
const violations = [];
let currentRule = "";
for (const line of checkText.split("\n")) {
  const ruleM = line.match(/^([a-z][a-z0-9-]+)\s+\(/);
  if (ruleM) currentRule = ruleM[1];
  const vM = line.match(/^\s*(NEW|CARRY|FIXED)\s+(ERROR|WARNING)\s+(\S+)\s+(.*)$/);
  if (vM) {
    violations.push({
      rule: currentRule || "rule",
      severity: vM[2] === "ERROR" ? "error" : "warning",
      file: vM[3],
      detail: vM[4].trim(),
      status: vM[1] === "NEW" ? "new" : vM[1] === "FIXED" ? "fixed" : "carry",
    });
  }
}

const hotspots = (report.hotspots ?? []).map((h) => ({
  nodeId: h.nodeId,
  churn: h.churn,
  complexity: h.complexity,
  score: h.score,
}));
const busFactorRisks = (report.busFactorRisks ?? []).map((b) => ({
  nodeId: b.nodeId,
  topAuthorShare: b.topAuthorShare ?? 1,
  churn: b.churn,
}));
const couplingClusters = (report.couplingClusters ?? []).map((c) => ({
  a: c.aId ?? c.a ?? c.nodeId,
  b: c.bId ?? c.b ?? c.other,
  coEdits: c.coEdits ?? c.count ?? 0,
  hidden: c.hidden ?? false,
}));
const centralFiles = (report.centralFiles ?? []).map((c) => ({
  nodeId: c.nodeId,
  score: c.score,
}));

const openNew = violations.filter((v) => v.status === "new").length;
const carry = violations.filter((v) => v.status === "carry").length;
const fixed = violations.filter((v) => v.status === "fixed").length;
const maxComplexity = hotspots.reduce((m, h) => Math.max(m, h.complexity), 0);
// Simple composite: start at 100, subtract for scary hotspots + open violations.
const scary = hotspots.filter((h) => h.score >= 3000).length;
const health = Math.max(0, Math.min(100, 100 - scary * 6 - (openNew + carry) * 5));

const vs = arg("vs");
// `graph report --json` emits `snapshot` as an object; older shapes as a number.
const snap = report.snapshot ?? {};
const snapId = typeof snap === "object" ? snap.id ?? 0 : snap;
const data = {
  meta: {
    repo: arg("repo", "repo"),
    snapshotId: snapId,
    ref: snap.ref ?? "wd",
    windowDays: report.windowDays ?? 30,
    generatedAt: new Date().toISOString(),
    indexVersion: snap.indexVersion ?? report.indexVersion ?? "0.2.0",
    fileCount: report.fileCount,
    authorCount: arg("authors") ? Number(arg("authors")) : undefined,
    emptyWindow: report.emptyWindow ?? hotspots.length === 0,
    hint: report.hint,
    baseline: vs ? { ref: vs.split(":")[0], snapshotId: Number(vs.split(":")[1] ?? 0) } : null,
  },
  kpis: {
    health,
    newHotspots: scary,
    knowledgeSilos: busFactorRisks.length,
    boundaryHealth: report.boundaryHealth,
    openViolations: { total: openNew + carry, new: openNew, carry, fixed },
    maxComplexity,
  },
  hotspots,
  busFactorRisks,
  couplingClusters,
  centralFiles,
  violations,
};

writeFileSync(arg("out"), JSON.stringify(data, null, 2));
console.log(`wrote ${arg("out")}: ${hotspots.length} hotspots, ${violations.length} violations, health ${health}`);
