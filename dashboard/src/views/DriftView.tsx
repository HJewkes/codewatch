import React from "react";
import { View, Text, Pressable } from "react-native";
import { EmptyState } from "@titan-design/react-ui";
import { GitCompareArrows } from "lucide-react";
import type { CodewatchData, HotspotDelta } from "../types";
import { Panel, Pillet } from "../components/primitives";
import { cw, shortId } from "../theme";

export function DriftView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const drift = data.drift;
  if (!drift) {
    return (
      <Panel title="Drift" subtitle="what changed vs a baseline snapshot">
        <EmptyState
          icon={GitCompareArrows as any}
          title="No baseline selected"
          description="Generate with `graph dashboard --vs previous` (or a snapshot ref) to see what moved since a prior snapshot."
        />
      </Panel>
    );
  }

  const worsened = [...drift.worsened].sort((a, b) => b.delta - a.delta);
  const improved = [...drift.improved].sort((a, b) => a.delta - b.delta);

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <Stat n={drift.newHotspots.length} label="new hotspots" color={cw.error} />
        <Stat n={worsened.length} label="worsened" color={cw.warning} />
        <Stat n={improved.length} label="improved" color={cw.success} />
        <Stat n={drift.resolved.length} label="resolved" color={cw.success} />
        <Stat n={drift.newSilos.length} label="new silos" color={cw.error} />
      </View>

      {drift.newHotspots.length ? (
        <Panel title="New hotspots" subtitle={`appeared since snapshot ${drift.baselineSnapshotId}`}>
          <View style={{ gap: 6 }}>
            {drift.newHotspots.map((h) => (
              <Row key={h.nodeId} id={h.nodeId} onSelect={onSelect} right={`${h.score}`} rightColor={cw.error} badge="new" badgeColor={cw.error} />
            ))}
          </View>
        </Panel>
      ) : null}

      {worsened.length ? (
        <Panel title="Worsened" subtitle="score went up vs baseline">
          <View style={{ gap: 6 }}>{worsened.map((d) => <DeltaRow key={d.nodeId} d={d} onSelect={onSelect} up />)}</View>
        </Panel>
      ) : null}

      {improved.length ? (
        <Panel title="Improved" subtitle="score went down vs baseline">
          <View style={{ gap: 6 }}>{improved.map((d) => <DeltaRow key={d.nodeId} d={d} onSelect={onSelect} up={false} />)}</View>
        </Panel>
      ) : null}

      {drift.resolved.length ? (
        <Panel title="Resolved" subtitle="no longer a hotspot vs baseline">
          <View style={{ gap: 6 }}>
            {drift.resolved.map((d) => (
              <Row key={d.nodeId} id={d.nodeId} onSelect={onSelect} right={`${d.before} → ${d.after}`} rightColor={cw.success} badge="resolved" badgeColor={cw.success} />
            ))}
          </View>
        </Panel>
      ) : null}

      {drift.newSilos.length ? (
        <Panel title="New knowledge silos" subtitle="became single-owner since baseline">
          <View style={{ gap: 6 }}>
            {drift.newSilos.map((id) => (
              <Row key={id} id={id} onSelect={onSelect} right="bus factor 1" rightColor={cw.error} badge="new" badgeColor={cw.error} />
            ))}
          </View>
        </Panel>
      ) : null}

      {drift.newCoupling.length ? (
        <Panel title="New coupling" subtitle="pairs that started co-changing">
          <View style={{ gap: 6 }}>
            {drift.newCoupling.map((c) => (
              <View key={c.a + c.b} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(c.a)} ↔ {shortId(c.b)}</Text>
                <Text style={{ color: cw.textFaint, fontSize: 12 }}>×{c.coEdits}</Text>
              </View>
            ))}
          </View>
        </Panel>
      ) : null}
    </View>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={{ backgroundColor: cw.surface, borderRadius: 10, borderWidth: 1, borderColor: cw.border, paddingVertical: 10, paddingHorizontal: 16, minWidth: 96 }}>
      <Text style={{ color, fontSize: 22, fontWeight: "700" }}>{n}</Text>
      <Text style={{ color: cw.textDim, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Row({ id, onSelect, right, rightColor, badge, badgeColor }: { id: string; onSelect: (id: string) => void; right: string; rightColor: string; badge?: string; badgeColor?: string }) {
  return (
    <Pressable onPress={() => onSelect(id)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {badge ? <Pillet text={badge} color={badgeColor ?? cw.info} /> : null}
      <Text style={{ color: cw.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{shortId(id)}</Text>
      <Text style={{ color: rightColor, fontSize: 13 }}>{right}</Text>
    </Pressable>
  );
}

function DeltaRow({ d, onSelect, up }: { d: HotspotDelta; onSelect: (id: string) => void; up: boolean }) {
  const color = up ? cw.warning : cw.success;
  const arrow = up ? "▲" : "▼";
  return (
    <Pressable onPress={() => onSelect(d.nodeId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ color: cw.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{shortId(d.nodeId)}</Text>
      <Text style={{ color: cw.textFaint, fontSize: 12 }}>{d.before} → {d.after}</Text>
      <Text style={{ color, fontSize: 13, width: 64, textAlign: "right" }}>{arrow} {Math.abs(d.delta)}</Text>
    </Pressable>
  );
}
