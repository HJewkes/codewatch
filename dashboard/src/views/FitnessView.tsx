import React from "react";
import { View, Text, Pressable } from "react-native";
import { EmptyState } from "@titan-design/react-ui";
import { ShieldCheck } from "lucide-react";
import type { CodewatchData, Violation } from "../types";
import { Panel, SeverityBadge, Pillet } from "../components/primitives";
import { cw, shortId, tint } from "../theme";

const STATUS_COLOR: Record<Violation["status"], string> = {
  new: cw.error,
  carry: cw.warning,
  fixed: cw.success,
};

const STATUS_LABEL: Record<Violation["status"], string> = {
  new: "new",
  carry: "parked",
  fixed: "fixed",
};

/** One-line intent per rule (thresholds live in .codewatch/check.json). */
const RULE_DESCRIPTIONS: Record<string, string> = {
  "max-file-loc": "Files over the line-count budget — split before they sprawl.",
  "max-cyclomatic-per-function": "A function's branch count exceeds the budget — decompose it.",
  "max-nesting-depth": "Control-flow nested too deep — flatten with early returns.",
  "max-fan-out-per-file": "A file imports too many others — a hub with too many responsibilities.",
  "package-layers": "A package imports across a forbidden layer boundary.",
  "scary-hotspots": "churn × complexity over the danger threshold — high-risk to change.",
  "no-internal-only-barrels": "A barrel re-exports only internal modules — dead indirection.",
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
      <RatchetBanner tally={tally} baselineRef={data.meta.baseline?.ref} />

      <View style={{ flexDirection: "row", gap: 12 }}>
        {/* "new" is the only blocking tally — green when zero, alarm when not. */}
        <Tally label="new" n={tally.new} color={tally.new === 0 ? cw.success : cw.error} />
        <Tally label="parked (carryover)" n={tally.carry} color={cw.warning} />
        <Tally label="fixed" n={tally.fixed} color={cw.success} />
      </View>

      {Array.from(byRule.entries()).map(([rule, vs]) => (
        <Panel
          key={rule}
          title={rule}
          subtitle={`${RULE_DESCRIPTIONS[rule] ?? "Architectural fitness rule."} · ${vs.length} violation${vs.length > 1 ? "s" : ""} · defined in .codewatch/check.json`}
        >
          <View style={{ gap: 10 }}>
            {vs.map((v, i) => (
              <Pressable
                key={i}
                onPress={() => onSelect(v.file)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                {/* Alarm severity badge only for blocking (new) rows; a parked
                    row's red "error" badge contradicts its non-blocking status. */}
                {v.status === "new" ? <SeverityBadge status={v.severity} /> : null}
                <Pillet text={STATUS_LABEL[v.status]} color={STATUS_COLOR[v.status]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(v.file)}</Text>
                  <Text style={{ color: cw.textFaint, fontSize: 12 }} numberOfLines={1}>
                    {v.status === "carry" ? `${v.severity} severity · ` : ""}{v.detail}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Panel>
      ))}
    </View>
  );
}

/** Lead verdict: is the guardrail holding (no new violations) or regressed? */
function RatchetBanner({ tally, baselineRef }: { tally: { new: number; carry: number; fixed: number }; baselineRef?: string }) {
  const holding = tally.new === 0;
  const color = holding ? cw.success : cw.error;
  const vsBaseline = baselineRef ? ` vs ${baselineRef}` : "";
  const title = holding
    ? "Guardrail holding"
    : `${tally.new} new violation${tally.new > 1 ? "s" : ""} since baseline`;
  const parked = tally.carry ? `${tally.carry} parked (not blocking)` : "no carryover";
  const fixed = `${tally.fixed} fixed`;
  return (
    <View
      style={{
        backgroundColor: tint(color, 0.1),
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tint(color, 0.4),
        padding: 16,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <ShieldCheck size={18} color={color} />
        <Text style={{ color: cw.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
      </View>
      <Text style={{ color: cw.textDim, fontSize: 13 }}>
        {tally.new} new{vsBaseline} · {parked} · {fixed}
      </Text>
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
