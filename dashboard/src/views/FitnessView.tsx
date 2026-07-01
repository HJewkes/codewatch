import React from "react";
import { View, Text } from "react-native";
import { EmptyState } from "@titan-design/react-ui";
import { ShieldCheck } from "lucide-react";
import type { CodewatchData, Violation } from "../types";
import { Panel, SeverityBadge, Pillet } from "../components/primitives";
import { cw, shortId } from "../theme";

const STATUS_COLOR: Record<Violation["status"], string> = {
  new: cw.error,
  carry: cw.warning,
  fixed: cw.success,
};

export function FitnessView({ data, onSelect, query }: { data: CodewatchData; onSelect: (id: string) => void; query?: string }) {
  const { violations } = data;

  if (violations.length === 0) {
    // Distinguish a filtered-out list from a genuinely clean repo.
    const filtered = !!query;
    return (
      <Panel title="Fitness checks" subtitle="architectural rules vs baseline">
        <EmptyState
          icon={ShieldCheck as any}
          title={filtered ? "No violations match the filter" : "All checks pass"}
          description={filtered
            ? `No rule violations on files matching “${query}”. Clear the filter to see all.`
            : "No rule violations in this snapshot. Baselines are holding."}
        />
      </Panel>
    );
  }

  // Tallies derived from the (possibly filtered) list so they match it.
  const tally = {
    new: violations.filter((v) => v.status === "new").length,
    carry: violations.filter((v) => v.status === "carry").length,
    fixed: violations.filter((v) => v.status === "fixed").length,
  };

  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const arr = byRule.get(v.rule) ?? [];
    arr.push(v);
    byRule.set(v.rule, arr);
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Tally label="new" n={tally.new} color={cw.error} />
        <Tally label="carryover" n={tally.carry} color={cw.warning} />
        <Tally label="fixed" n={tally.fixed} color={cw.success} />
      </View>
      {Array.from(byRule.entries()).map(([rule, vs]) => (
        <Panel key={rule} title={rule} subtitle={`${vs.length} violation${vs.length > 1 ? "s" : ""}`}>
          <View style={{ gap: 10 }}>
            {vs.map((v, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <SeverityBadge status={v.severity} />
                <Pillet text={v.status} color={STATUS_COLOR[v.status]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(v.file)}</Text>
                  <Text style={{ color: cw.textFaint, fontSize: 12 }} numberOfLines={1}>{v.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </Panel>
      ))}
    </View>
  );
}

function Tally({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <View style={{ backgroundColor: cw.surface, borderRadius: 10, borderWidth: 1, borderColor: cw.border, paddingVertical: 10, paddingHorizontal: 16, minWidth: 100 }}>
      <Text style={{ color, fontSize: 22, fontWeight: "700" }}>{n}</Text>
      <Text style={{ color: cw.textDim, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
