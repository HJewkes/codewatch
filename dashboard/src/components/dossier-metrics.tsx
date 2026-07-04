import React from "react";
import { View, Text } from "react-native";
import type { CodewatchData, HotExport, NodeMetrics } from "../types";
import { cw, metricHeat, METRIC_BUDGET, tint } from "../theme";

/** Per-metric labels + the fitness-budget key that anchors each row's heat. */
const METRIC_ROWS: { key: keyof NodeMetrics; label: string; budgetKey?: string }[] = [
  { key: "loc", label: "Lines of code", budgetKey: "loc" },
  { key: "cognitiveMax", label: "Cognitive (max fn)", budgetKey: "cognitive_max" },
  { key: "cyclomaticMax", label: "Cyclomatic (max fn)", budgetKey: "cyclomatic_max" },
  { key: "maxNesting", label: "Nesting depth", budgetKey: "max_nesting_depth" },
  { key: "fanOut", label: "Fan-out", budgetKey: "fan_out" },
  { key: "fanIn", label: "Fan-in" },
];

/**
 * Heat-colored structural readout: each metric is colored + bar-scaled against the
 * repo's own fitness budget, so the drawer shows at a glance which dimension pushes
 * a file toward (or over) a rule. Fan-in has no budget — shown neutral, no bar.
 */
export function MetricReadout({ m }: { m: NodeMetrics }) {
  const rows = METRIC_ROWS.filter((r) => m[r.key] !== undefined);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: cw.textDim, fontSize: 12, fontWeight: "600" }}>Structural metrics</Text>
      {rows.map((r) => {
        const value = m[r.key] as number;
        const budget = r.budgetKey ? METRIC_BUDGET[r.budgetKey] : undefined;
        const color = metricHeat(value, budget);
        const ratio = budget ? Math.min(1, value / budget) : 0;
        return (
          <View key={r.key} style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={{ color: cw.textDim, fontSize: 12 }}>{r.label}</Text>
              <Text style={{ fontSize: 12 }}>
                <Text style={{ color, fontWeight: "700" }}>{value}</Text>
                {budget !== undefined ? <Text style={{ color: cw.textFaint }}> / {budget}</Text> : null}
              </Text>
            </View>
            {budget !== undefined ? (
              <View style={{ height: 3, borderRadius: 2, backgroundColor: tint(cw.textFaint, 0.25), overflow: "hidden" }}>
                <View style={{ height: 3, width: `${ratio * 100}%`, backgroundColor: color, borderRadius: 2 }} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Largest utilization across the openable files, for scaling the Dossier bar. */
export function maxUtilization(nodeMetrics: CodewatchData["nodeMetrics"]): number {
  let max = 0;
  for (const m of Object.values(nodeMetrics ?? {})) {
    if (m.utilization !== undefined && m.utilization > max) max = m.utilization;
  }
  return max;
}

/** A file is "complex" for blast-radius purposes if its worst function nears the cognitive budget. */
export function isComplex(m: NodeMetrics): boolean {
  return m.cognitiveMax !== undefined && m.cognitiveMax >= METRIC_BUDGET.cognitive_max * 0.75;
}

/**
 * Utilization (C-52): how heavily a file's exports are actually referenced across
 * the repo (inbound reference count, not merely importer count). Measured on the
 * BARREL-RESOLVED edge set (C-53) — references that route through an `index.ts`
 * re-export hub are credited to the file that actually defines them, so a barrel
 * reads utilization ~0 (it forwards, it isn't used) while its targets get the
 * credit. High utilization is not itself a defect — a heavily-used, simple,
 * stable file is a solid foundation — so it reads in the informational accent,
 * not the danger heat. The warning only fires when a load-bearing file is ALSO
 * complex or churning: that intersection is blast radius (idea (d) of C-52).
 */
export function UtilizationRow({ value, max, complex, churning, isBarrel }: { value: number; max: number; complex: boolean; churning: boolean; isBarrel?: boolean }) {
  const shown = Math.round(value);
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const loadBearing = ratio >= 0.66 && value >= 3;
  const blastRadius = loadBearing && (complex || churning);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ color: cw.textDim, fontSize: 12 }}>Utilization (inbound refs)</Text>
        <Text style={{ color: cw.info, fontSize: 12, fontWeight: "700" }}>{shown}</Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: tint(cw.info, 0.2), overflow: "hidden" }}>
        <View style={{ height: 3, width: `${ratio * 100}%`, backgroundColor: cw.info, borderRadius: 2 }} />
      </View>
      {isBarrel ? (
        <Text style={{ color: cw.textFaint, fontSize: 11 }}>Re-export barrel — utilization is credited to the files it forwards, not the hub.</Text>
      ) : blastRadius ? (
        <Text style={{ color: cw.warning, fontSize: 11 }}>
          Load-bearing and {complex ? "complex" : "churning"} — wide blast radius; change carefully.
        </Text>
      ) : loadBearing ? (
        <Text style={{ color: cw.textFaint, fontSize: 11 }}>Load-bearing foundation — widely depended on.</Text>
      ) : null}
    </View>
  );
}

/**
 * A file's exports, decomposed (C-53 utilization + C-58 complexity + C-59
 * consumers). Answers "if I touch this file, which export ripples, how risky is
 * it, and who depends on it?" — the per-symbol readout obs #5 asked for. Each
 * export shows its OWN cognitive complexity (heat-colored against the fitness
 * budget), a utilization bar scaled to the file's hottest export, and its
 * consumer count. Ranked utilization-then-complexity; unused-but-complex exports
 * are kept (they're worth seeing), so this is the full public surface, capped.
 */
export function ExportsTable({ exports }: { exports: HotExport[] }) {
  if (!exports?.length) return null;
  const max = exports.reduce((m, e) => Math.max(m, e.utilization), 0);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: cw.textDim, fontSize: 12, fontWeight: "600" }}>Exports</Text>
      {exports.map((e) => {
        const ratio = max > 0 ? Math.min(1, e.utilization / max) : 0;
        const cxColor = e.cognitive !== undefined ? metricHeat(e.cognitive, METRIC_BUDGET.cognitive_max) : cw.textFaint;
        return (
          <View key={e.name} style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <Text style={{ color: cw.text, fontSize: 12, fontFamily: "monospace", flex: 1 } as any} numberOfLines={1}>{e.name}</Text>
              {e.cognitive !== undefined ? (
                <Text style={{ fontSize: 11 }}>
                  <Text style={{ color: cw.textFaint }}>cx </Text>
                  <Text style={{ color: cxColor, fontWeight: "700" }}>{e.cognitive}</Text>
                </Text>
              ) : null}
            </View>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: tint(cw.info, 0.2), overflow: "hidden" }}>
              <View style={{ height: 3, width: `${ratio * 100}%`, backgroundColor: cw.info, borderRadius: 2 }} />
            </View>
            <Text style={{ color: cw.textFaint, fontSize: 10 }}>
              util {Math.round(e.utilization)} · {e.consumers} consumer{e.consumers === 1 ? "" : "s"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** "churn × complexity = score", inserting the recency factor only when it discounts. */
export function hotspotBreakdown(h: { churn: number; complexity: number; score: number; recency?: number }): string {
  const discounted = h.recency !== undefined && h.recency < 1;
  const factors = discounted ? `${h.churn} × ${h.complexity} × ${h.recency}` : `${h.churn} × ${h.complexity}`;
  return `${factors} = ${h.score}`;
}

export function DossierRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: cw.textDim, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: valueColor ?? cw.text, fontSize: 13, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}
