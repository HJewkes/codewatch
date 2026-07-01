import React from "react";
import { View, Text, Pressable } from "react-native";
import { Scatter, EmptyState } from "@titan-design/react-ui";
import { Network } from "lucide-react";
import type { CodewatchData, PackageStat } from "../types";
import { Panel, Pillet } from "../components/primitives";
import { cw } from "../theme";

/** Distance from the main sequence |I + A − 1|; 0 = ideally balanced. */
function distance(p: PackageStat): number {
  return Math.abs(p.instability + p.abstractness - 1);
}

function zone(p: PackageStat): { label: string; color: string } {
  const sum = p.instability + p.abstractness;
  if (distance(p) <= 0.25) return { label: "on sequence", color: cw.success };
  if (sum < 1) return { label: "zone of pain", color: cw.error };
  return { label: "zone of uselessness", color: cw.warning };
}

export function ArchitectureView({ data, onSelect, width }: { data: CodewatchData; onSelect: (id: string) => void; width: number }) {
  const pkgs = (data.packages ?? []).filter((p) => p.fileCount > 0);

  if (pkgs.length === 0) {
    return (
      <Panel title="Architecture" subtitle="package main sequence (instability × abstractness)">
        <EmptyState
          icon={Network as any}
          title="No package structure"
          description="This repo has no multi-package boundaries to plot (a flat src/ tree). The main sequence needs ≥2 packages."
        />
      </Panel>
    );
  }

  const maxFiles = Math.max(...pkgs.map((p) => p.fileCount));
  const points = pkgs.map((p) => ({
    id: p.pkgId,
    x: p.instability,
    y: p.abstractness,
    r: 6 + Math.sqrt(p.fileCount / maxFiles) * 16,
    color: zone(p).color,
    label: p.pkgId.replace(/^packages\//, ""),
  }));
  const plotW = Math.max(360, Math.min(width - 360, 620));
  const ranked = [...pkgs].sort((a, b) => distance(b) - distance(a));

  return (
    <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
      <Panel title="Main sequence" subtitle="instability (I) × abstractness (A); the diagonal I+A=1 is ideal">
        <Scatter
          data={points}
          width={plotW}
          height={Math.min(plotW, 420)}
          diagonal
          axis={{ xLabel: "Instability →", yLabel: "Abstractness →", xMin: 0, xMax: 1, yMin: 0, yMax: 1 }}
          onPress={onSelect}
        />
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <Legend color={cw.success} label="on sequence" />
          <Legend color={cw.error} label="zone of pain (stable + concrete)" />
          <Legend color={cw.warning} label="zone of uselessness (unstable + abstract)" />
        </View>
      </Panel>

      <Panel title="Packages" subtitle="ranked by distance from the main sequence" flex={1}>
        <View style={{ gap: 8 }}>
          {ranked.map((p) => {
            const z = zone(p);
            return (
              <Pressable key={p.pkgId} onPress={() => onSelect(p.pkgId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: cw.text, fontSize: 13 }}>{p.pkgId.replace(/^packages\//, "")}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                    <Pillet text={p.layer} color={cw.info} />
                    <Pillet text={z.label} color={z.color} />
                  </View>
                </View>
                <Text style={{ color: cw.textDim, fontSize: 12, width: 96, textAlign: "right" }}>
                  I {p.instability.toFixed(2)} · A {p.abstractness.toFixed(2)}
                </Text>
                <Text style={{ color: z.color, fontSize: 12, width: 40, textAlign: "right" }}>D {distance(p).toFixed(2)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Panel>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: cw.textFaint, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
