import React from "react";
import { View, Text, Pressable } from "react-native";
import { EmptyState } from "@titan-design/react-ui";
import { GitCompareArrows } from "lucide-react";
import type { CodewatchData, HotspotDelta, Violation } from "../types";
import { Panel, Pillet } from "../components/primitives";
import { cw, shortId, tint, SCARY_SCORE } from "../theme";

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

  // Split "new hotspots" into newborn files (neutral — a fresh file being busy
  // is expected) and existing files that climbed into the ranking (the real
  // signal; alarming when they cross the scary cutoff). Sort risen scary-first.
  const newborn = drift.newHotspots.filter((h) => h.before === undefined);
  const risen = drift.newHotspots
    .filter((h) => h.before !== undefined)
    .sort((a, b) => b.score - a.score);

  // Lead with a regression that already trips a fitness rule: a worsened file
  // that also has an open violation is the single most actionable thing here.
  const violationByFile = new Map(data.violations.map((v) => [v.file, v] as const));
  const lead = worsened.find((d) => violationByFile.has(d.nodeId));

  return (
    <View style={{ gap: 16 }}>
      {lead ? <RegressionLead d={lead} violation={violationByFile.get(lead.nodeId)!} onSelect={onSelect} /> : null}

      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <Stat n={risen.filter((h) => h.score >= SCARY_SCORE).length} label="crossed scary" color={cw.error} />
        <Stat n={risen.length} label="rose into list" color={cw.warning} />
        <Stat n={newborn.length} label="new files" color={cw.info} />
        <Stat n={worsened.length} label="worsened" color={cw.warning} />
        <Stat n={improved.length} label="improved" color={cw.success} />
        <Stat n={drift.resolved.length} label="resolved" color={cw.success} />
        <Stat n={drift.newSilos.length} label="new silos" color={cw.error} />
      </View>

      {risen.length ? (
        <Panel title="Rose into the hotspot list" subtitle="existing files whose churn × complexity climbed since baseline — the real regressions">
          <View style={{ gap: 6 }}>
            {risen.map((h) => {
              const scary = h.score >= SCARY_SCORE;
              return (
                <Row
                  key={h.nodeId}
                  id={h.nodeId}
                  onSelect={onSelect}
                  right={`${h.before} → ${h.score}`}
                  rightColor={scary ? cw.error : cw.warning}
                  badge={scary ? "crossed scary" : "entered"}
                  badgeColor={scary ? cw.error : cw.warning}
                />
              );
            })}
          </View>
        </Panel>
      ) : null}

      {newborn.length ? (
        <Panel title="New files" subtitle={`added since snapshot ${drift.baselineSnapshotId} — expected to show churn, not inherently a regression`}>
          <View style={{ gap: 6 }}>
            {newborn.map((h) => (
              <Row key={h.nodeId} id={h.nodeId} onSelect={onSelect} right={`${h.score}`} rightColor={cw.textDim} badge="new" badgeColor={cw.info} />
            ))}
          </View>
        </Panel>
      ) : null}

      {worsened.length ? (
        <Panel title="Worsened" subtitle="already in the list; score went up vs baseline">
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
              <View key={c.a + c.b} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text style={{ color: cw.text, fontSize: 13, flexShrink: 1, minWidth: 0 }} numberOfLines={1}>{shortId(c.a)} ↔ {shortId(c.b)}</Text>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  {c.hidden ? <Pillet text="hidden" color={cw.error} /> : null}
                  <Text style={{ color: cw.textFaint, fontSize: 12 }}>×{c.coEdits}</Text>
                </View>
              </View>
            ))}
          </View>
        </Panel>
      ) : null}
    </View>
  );
}

/** The headline: a regression that already trips a fitness rule. */
function RegressionLead({ d, violation, onSelect }: { d: HotspotDelta; violation: Violation; onSelect: (id: string) => void }) {
  return (
    <Pressable
      onPress={() => onSelect(d.nodeId)}
      style={{
        backgroundColor: tint(cw.error, 0.1),
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tint(cw.error, 0.4),
        padding: 16,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pillet text="regression" color={cw.error} />
        <Pillet text={violation.rule} color={cw.error} />
        <Text style={{ color: cw.text, fontSize: 15, fontWeight: "700", flexShrink: 1, minWidth: 0 }} numberOfLines={1}>{shortId(d.nodeId)}</Text>
      </View>
      <Text style={{ color: cw.textDim, fontSize: 13 }}>
        Worsened {d.before} → {d.after} (▲{d.delta}) since baseline and now trips {violation.rule}.
      </Text>
      <Text style={{ color: cw.textFaint, fontSize: 12 }}>{violation.detail}</Text>
    </Pressable>
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
