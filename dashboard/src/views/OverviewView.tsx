import React from "react";
import { View, Text } from "react-native";
import { Alert, AlertTitle, AlertDescription } from "@titan-design/react-ui";
import type { CodewatchData } from "../types";
import { Panel, KpiTile, Bar, Pillet } from "../components/primitives";
import { Treemap } from "../components/Treemap";
import { cw, healthColor, hotspotColor, shortId, pkgOf, pct } from "../theme";

function trendDir(n?: number): "up" | "down" | "flat" {
  if (n === undefined || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

export function OverviewView({ data, onSelect, width }: { data: CodewatchData; onSelect: (id: string) => void; width: number }) {
  const { kpis, meta } = data;
  const singleAuthor = meta.authorCount === 1;
  const tmWidth = Math.max(280, Math.min(520, width - 340));

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
          trend={{ direction: trendDir(kpis.healthTrend), value: kpis.healthTrend ? `${kpis.healthTrend > 0 ? "+" : ""}${kpis.healthTrend}` : "0" }}
          accent={healthColor(kpis.health)} />
        <KpiTile label="new hotspots" value={String(kpis.newHotspots)} accent={cw.warning} />
        <KpiTile label="knowledge silos" value={String(kpis.knowledgeSilos)} accent={cw.error} />
        <KpiTile label="boundary Q" value={kpis.boundaryHealth != null ? kpis.boundaryHealth.toFixed(2) : "—"} accent={cw.info} />
        <KpiTile label="open violations" value={String(kpis.openViolations.total)}
          unit={kpis.openViolations.new ? `+${kpis.openViolations.new}` : undefined} accent={cw.error} />
        <KpiTile label="max complexity" value={String(kpis.maxComplexity)} accent={cw.brand} />
      </View>

      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        {/* Where to look */}
        <Panel title="Where to look first" subtitle="ranked by churn × complexity, with reasons" flex={1}>
          <View style={{ gap: 8 }}>
            {whereToLook.map((h, i) => (
              <View key={h.nodeId} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: cw.textFaint, width: 16, fontSize: 12 }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(h.nodeId)}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                    {h.reasons.map((r) => (
                      <Pillet key={r} text={r} color={r === "violation" || r === "scary hotspot" ? cw.error : r === "bus factor 1" ? cw.warning : cw.info} />
                    ))}
                  </View>
                </View>
                <Bar frac={Math.min(1, h.score / 5000)} color={hotspotColor(h.score)} />
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
        subtitle={meta.baseline ? `vs ${meta.baseline.ref} (snap ${meta.baseline.snapshotId})` : "no baseline selected"}>
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
