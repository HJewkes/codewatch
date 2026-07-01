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
  // Wide "balanced" band — the abstractness proxy is coarse (type-file share),
  // so only flag genuinely extreme corners to avoid false alarms.
  if (distance(p) <= 0.45) return { label: "balanced", color: cw.success };
  if (sum < 0.55) return { label: "rigid (stable + concrete)", color: cw.warning };
  return { label: "unstable + abstract", color: cw.warning };
}

export function ArchitectureView({ data, onSelect, width }: { data: CodewatchData; onSelect: (id: string) => void; width: number }) {
  // Drop isolated dirs (no cross-package edges): their I=0/0 is meaningless and
  // pollutes the plot on non-monorepos (spike/ dirs etc.).
  const pkgs = (data.packages ?? []).filter((p) => p.fileCount > 0 && (p.crossEdges ?? 1) > 0);

  if (pkgs.length < 2) {
    return (
      <Panel title="Architecture" subtitle="package main sequence (instability × abstractness)">
        <EmptyState
          icon={Network as any}
          title="No package structure"
          description="This repo has no connected multi-package boundaries to plot (a flat src/ tree). The main sequence needs ≥2 packages with cross-package dependencies."
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
      <Panel title="Main sequence" subtitle="instability I × abstractness A; diagonal I+A=1 is balanced. A = type-file share (proxy)">
        <Scatter
          data={points}
          width={plotW}
          height={Math.min(plotW, 420)}
          diagonal
          axis={{ xLabel: "Instability →", yLabel: "Abstractness →", xMin: 0, xMax: 1, yMin: 0, yMax: 1 }}
          onPress={onSelect}
        />
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <Legend color={cw.success} label="balanced" />
          <Legend color={cw.warning} label="far from sequence" />
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
