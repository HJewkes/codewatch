import type { Command } from "commander";
import { registerGraphArch } from "./graph-arch.js";
import { registerGraphAutoUpdate } from "./graph-auto-update.js";
import { registerGraphCheck } from "./graph-check.js";
import { registerGraphCheckDiff } from "./graph-check-diff.js";
import { registerGraphCoupled } from "./graph-coupled.js";
import { registerGraphCoverage } from "./graph-coverage.js";
import { registerGraphDashboard } from "./graph-dashboard.js";
import { registerGraphDiff } from "./graph-diff.js";
import { registerGraphIndex } from "./graph-index.js";
import { registerGraphInit } from "./graph-init.js";
import { registerGraphPrune } from "./graph-prune.js";
import { registerGraphRelevant } from "./graph-relevant.js";
import { registerGraphRenderCheckDiff } from "./graph-render-check-diff.js";
import { registerRender, registerRenderDiff } from "./graph-render-cli.js";
import { registerGraphReport } from "./graph-report.js";
import { registerGraphTop } from "./graph-top.js";
import { registerGraphWiki } from "./graph-wiki.js";

export function registerGraphCommands(program: Command): void {
  const graphCmd = program
    .command("graph")
    .description("Code graph commands (index, query, render, check)");

  registerGraphInit(graphCmd);
  registerGraphIndex(graphCmd);
  registerGraphAutoUpdate(graphCmd);
  registerGraphDiff(graphCmd);
  registerGraphCheck(graphCmd);
  registerGraphCheckDiff(graphCmd);
  registerGraphTop(graphCmd);
  registerGraphRelevant(graphCmd);
  registerGraphCoupled(graphCmd);
  registerGraphReport(graphCmd);
  registerGraphCoverage(graphCmd);
  registerGraphDashboard(graphCmd);
  registerGraphWiki(graphCmd);
  registerGraphArch(graphCmd);
  registerRenderDiff(graphCmd);
  registerRender(graphCmd);
  registerGraphRenderCheckDiff(graphCmd);
  registerGraphPrune(graphCmd);
}
