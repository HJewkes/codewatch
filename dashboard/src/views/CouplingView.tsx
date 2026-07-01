import React from "react";
import { View, Text, Pressable } from "react-native";
import { EmptyState, Alert, AlertTitle, AlertDescription } from "@titan-design/react-ui";
import { Link2 } from "lucide-react";
import type { CodewatchData } from "../types";
import { Panel, Bar, Pillet } from "../components/primitives";
import { cw, shortId } from "../theme";

export function CouplingView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const pairs = [...data.couplingClusters].sort((a, b) => b.coEdits - a.coEdits);
  const hidden = pairs.filter((p) => p.hidden);
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
      {hidden.length ? (
        <Alert status="warning" variant="subtle">
          <AlertTitle>{hidden.length} hidden coupling pair{hidden.length > 1 ? "s" : ""}</AlertTitle>
          <AlertDescription>
            These files change together but have no import edge between them — the most
            actionable coupling signal (an undocumented dependency or a missing abstraction).
          </AlertDescription>
        </Alert>
      ) : null}
      <Panel title="Change-coupled pairs" subtitle="ranked by co-edit count">
        <View style={{ gap: 10 }}>
          {pairs.map((p) => (
            <View key={p.a + p.b} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {p.hidden ? <Pillet text="hidden" color={cw.warning} /> : null}
              <Pressable style={{ flex: 1 }} onPress={() => onSelect(p.a)}>
                <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(p.a)}</Text>
              </Pressable>
              <Text style={{ color: cw.textFaint }}>↔</Text>
              <Pressable style={{ flex: 1 }} onPress={() => onSelect(p.b)}>
                <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(p.b)}</Text>
              </Pressable>
              <Bar frac={p.coEdits / maxCoEdits} color={p.hidden ? cw.warning : cw.info} width={70} />
              <Text style={{ color: cw.textDim, fontSize: 12, width: 34, textAlign: "right" }}>×{p.coEdits}</Text>
            </View>
          ))}
        </View>
      </Panel>
    </View>
  );
}
