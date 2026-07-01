import React from "react";
import { View, Text, Pressable } from "react-native";
import { EmptyState } from "@titan-design/react-ui";
import { Link2, ShieldCheck } from "lucide-react";
import type { CodewatchData, CouplingPair } from "../types";
import { Panel, Bar } from "../components/primitives";
import { cw, shortId } from "../theme";

export function CouplingView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const pairs = [...data.couplingClusters].sort((a, b) => b.coEdits - a.coEdits);
  const hidden = pairs.filter((p) => p.hidden);
  const expected = pairs.filter((p) => !p.hidden);
  const maxCoEdits = Math.max(1, ...pairs.map((p) => p.coEdits));

  if (pairs.length === 0) {
    return (
      <Panel title="Change coupling" subtitle="files that change together">
        <EmptyState
          icon={Link2 as any}
          title="No co-change clusters in the window"
          description="Files co-edited in ≥2 commits appear here. A dormant or very fresh window shows nothing."
        />
      </Panel>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {/* Lead with the actionable signal: co-change NOT explained by an import. */}
      <Panel
        title="Hidden coupling"
        subtitle="change together but with no import between them — an undocumented dependency or missing abstraction"
      >
        {hidden.length === 0 ? (
          <EmptyState
            icon={ShieldCheck as any}
            title="No hidden coupling"
            description="Every co-changed pair is import-backed — the coupling is all explained by the static dependency graph."
          />
        ) : (
          <PairList pairs={hidden} maxCoEdits={maxCoEdits} onSelect={onSelect} tone="hidden" />
        )}
      </Panel>

      {/* Expected co-change (import-backed) is demoted: usually a test with its
          source, a generated asset with its generator, or sibling modules. */}
      {expected.length ? (
        <Panel title="Expected co-change" subtitle="import-backed pairs that change together — usually fine">
          <PairList pairs={expected} maxCoEdits={maxCoEdits} onSelect={onSelect} tone="expected" />
        </Panel>
      ) : null}
    </View>
  );
}

function PairList({
  pairs,
  maxCoEdits,
  onSelect,
  tone,
}: {
  pairs: CouplingPair[];
  maxCoEdits: number;
  onSelect: (id: string) => void;
  tone: "hidden" | "expected";
}) {
  const barColor = tone === "hidden" ? cw.warning : cw.textFaint;
  return (
    <View style={{ gap: 10 }}>
      {pairs.map((p) => (
        <View key={p.a + p.b} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable style={{ flex: 1 }} onPress={() => onSelect(p.a)}>
            <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(p.a)}</Text>
          </Pressable>
          <Text style={{ color: cw.textFaint }}>↔</Text>
          <Pressable style={{ flex: 1 }} onPress={() => onSelect(p.b)}>
            <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(p.b)}</Text>
          </Pressable>
          <Bar frac={p.coEdits / maxCoEdits} color={barColor} width={70} />
          <Text style={{ color: cw.textDim, fontSize: 12, width: 34, textAlign: "right" }}>×{p.coEdits}</Text>
        </View>
      ))}
    </View>
  );
}
