import React from "react";
import { View, Text, Pressable } from "react-native";
import { Alert, AlertTitle, AlertDescription, Gauge } from "@titan-design/react-ui";
import type { CodewatchData } from "../types";
import { Panel, KpiTile, Bar, Pillet } from "../components/primitives";
import { Treemap } from "../components/Treemap";
import { RiskRadar } from "../components/RiskRadar";
import { buildDriftIndex, DriftBadge } from "../components/driftBadge";
import { cw, healthColor, hotspotColor, shortId, pkgOf, pct, SCARY_SCORE } from "../theme";

function trendDir(n?: number): "up" | "down" | "flat" {
  if (n === undefined || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** "vs <ref>", appending "(snap N)" only when it adds info (resolved and ≠ ref). */
function baselineLabel(baseline: { ref: string; snapshotId: number }): string {
  const showSnap = baseline.snapshotId > 0 && String(baseline.snapshotId) !== baseline.ref;
  return `vs ${baseline.ref}${showSnap ? ` (snap ${baseline.snapshotId})` : ""}`;
}

export function OverviewView({ data, onSelect, width }: { data: CodewatchData; onSelect: (id: string) => void; width: number }) {
  const { kpis, meta } = data;
  const singleAuthor = meta.authorCount === 1;
  const tmWidth = Math.max(280, Math.min(520, width - 340));
  const drift = buildDriftIndex(data.drift);

  // Novel: normalized multi-axis risk profile (higher = worse).
  const riskAxes = [
    { label: "hotspots", value: clamp01((data.hotspots[0]?.score ?? 0) / 5000) },
    { label: "silos", value: clamp01(kpis.knowledgeSilos / 15) },
    { label: "coupling", value: clamp01(data.couplingClusters.length / 10) },
    { label: "complexity", value: clamp01(kpis.maxComplexity / 30) },
    { label: "violations", value: clamp01(kpis.openViolations.total / 8) },
    { label: "boundaries", value: clamp01(1 - (kpis.boundaryHealth ?? 0.5)) },
  ];
  // Novel: "reading order" — the smallest starting set to understand the repo,
  // approximated by PageRank centrality (most-depended-upon files first).
  const readingOrder = data.centralFiles.slice(0, 6);

  const whereToLook = data.hotspots.slice(0, 8).map((h) => {
    const reasons: string[] = [];
    if (h.score >= 3000) reasons.push("scary hotspot");
    if (data.busFactorRisks.some((b) => b.nodeId === h.nodeId)) reasons.push("bus factor 1");
    if (data.violations.some((v) => v.file === h.nodeId)) reasons.push("violation");
    return { ...h, reasons: reasons.length ? reasons : ["high churn×complexity"] };
  });

  const tmData = data.hotspots.map((h) => ({
    id: h.nodeId,
    value: h.score,
    color: hotspotColor(h.score),
    label: h.nodeId.split("/").pop(),
  }));

  return (
    <View style={{ gap: 16 }}>
      {meta.emptyWindow ? (
        <Alert status="warning" variant="subtle">
          <AlertTitle>No commits in the last {meta.windowDays}d</AlertTitle>
          <AlertDescription>
            {meta.hint ?? "Churn-based widgets are empty. Widen the window to recover signal."}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* KPI row */}
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <KpiTile label="health" value={String(kpis.health)} unit="/100"
          trend={kpis.healthTrend !== undefined ? { direction: trendDir(kpis.healthTrend), value: `${kpis.healthTrend > 0 ? "+" : ""}${kpis.healthTrend}` } : undefined}
          accent={healthColor(kpis.health)} />
        <KpiTile label="scary hotspots" value={String(kpis.scaryHotspots)} accent={cw.warning} />
        <KpiTile label="knowledge silos" value={String(kpis.knowledgeSilos)} accent={cw.error} />
        <KpiTile label="boundary Q" value={kpis.boundaryHealth != null ? kpis.boundaryHealth.toFixed(2) : "—"} accent={cw.info} />
        <KpiTile label="open violations" value={String(kpis.openViolations.total)}
          unit={kpis.openViolations.new ? `+${kpis.openViolations.new}` : undefined} accent={cw.error} />
        <KpiTile label="max complexity" value={String(kpis.maxComplexity)} accent={cw.brand} />
      </View>

      {/* Hero row: health gauge · risk radar · reading order */}
      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        <Panel title="Health">
          <View style={{ alignItems: "center" }}>
            <Gauge value={kpis.health} size={150} label="composite" unit="/100" />
          </View>
        </Panel>
        <Panel title="Risk radar" subtitle="normalized risk across 6 axes">
          <View style={{ alignItems: "center" }}>
            <RiskRadar axes={riskAxes} size={230} />
          </View>
        </Panel>
        <Panel title="Reading order" subtitle="smallest set to grok the repo (by centrality)" flex={1}>
          <View style={{ gap: 7 }}>
            {readingOrder.map((c, i) => (
              <Pressable key={c.nodeId} onPress={() => onSelect(c.nodeId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: cw.brand, width: 16, fontSize: 12, fontWeight: "700" }}>{i + 1}</Text>
                <Text style={{ color: cw.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{shortId(c.nodeId)}</Text>
                <Bar frac={c.score / (readingOrder[0]?.score || 1)} color={cw.info} width={60} />
              </Pressable>
            ))}
          </View>
        </Panel>
      </View>

      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        {/* Where to look */}
        <Panel title="Where to look first" subtitle="ranked by churn × complexity, with reasons" flex={1}>
          <View style={{ gap: 8 }}>
            {whereToLook.map((h, i) => (
              <View key={h.nodeId} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: cw.textFaint, width: 16, fontSize: 12 }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: cw.text, fontSize: 13, flexShrink: 1, minWidth: 0 }} numberOfLines={1}>{shortId(h.nodeId)}</Text>
                    <DriftBadge mark={drift.get(h.nodeId)} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                    {h.reasons.map((r) => (
                      <Pillet key={r} text={r} color={r === "violation" || r === "scary hotspot" ? cw.error : r === "bus factor 1" ? cw.warning : cw.info} />
                    ))}
                  </View>
                </View>
                <Bar frac={Math.min(1, h.score / 5000)} color={hotspotColor(h.score)} threshold={SCARY_SCORE / 5000} />
                <Text style={{ color: cw.textDim, fontSize: 12, width: 46, textAlign: "right" }}>{h.score}</Text>
              </View>
            ))}
          </View>
        </Panel>

        {/* Hotspot treemap */}
        <Panel title="Hotspot map" subtitle="area = severity (churn × complexity)">
          {tmData.length ? (
            <Treemap data={tmData} width={tmWidth} height={220} onSelect={onSelect} maxTiles={40} />
          ) : (
            <Text style={{ color: cw.textFaint }}>No churn in window.</Text>
          )}
        </Panel>
      </View>

      {/* What changed */}
      <Panel title="What changed since baseline"
        subtitle={meta.baseline ? baselineLabel(meta.baseline) : "no baseline selected"}>
        <View style={{ flexDirection: "row", gap: 20, flexWrap: "wrap" }}>
          <Stat label="violations fixed" value={kpis.openViolations.fixed} color={cw.success} />
          <Stat label="new violations" value={kpis.openViolations.new} color={cw.error} />
          <Stat label="carryover" value={kpis.openViolations.carry} color={cw.warning} />
          {singleAuthor ? (
            <Stat label="authors" value="single" color={cw.textFaint} note="ownership widgets N/A" />
          ) : null}
        </View>
      </Panel>
    </View>
  );
}

function Stat({ label, value, color, note }: { label: string; value: number | string; color: string; note?: string }) {
  return (
    <View>
      <Text style={{ color, fontSize: 22, fontWeight: "700" }}>{value}</Text>
      <Text style={{ color: cw.textDim, fontSize: 12 }}>{label}</Text>
      {note ? <Text style={{ color: cw.textFaint, fontSize: 11 }}>{note}</Text> : null}
    </View>
  );
}
