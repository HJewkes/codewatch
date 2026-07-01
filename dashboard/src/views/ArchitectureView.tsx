import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Scatter, EmptyState } from "@titan-design/react-ui";
import { Network } from "lucide-react";
import type { CodewatchData, PackageStat } from "../types";
import { Panel, Pillet } from "../components/primitives";
import { loadGraphHtml } from "../data";
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

type ArchTab = "sequence" | "graph";

export function ArchitectureView({ data, onSelect, width }: { data: CodewatchData; onSelect: (id: string) => void; width: number }) {
  const graphB64 = loadGraphHtml();
  const [tab, setTab] = useState<ArchTab>("sequence");

  // Drop isolated dirs (no cross-package edges): their I=0/0 is meaningless and
  // pollutes the plot on non-monorepos (spike/ dirs etc.).
  const pkgs = (data.packages ?? []).filter((p) => p.fileCount > 0 && (p.crossEdges ?? 1) > 0);

  // The dependency graph is a whole-repo view; show it even when there aren't
  // ≥2 packages for the main sequence.
  if (graphB64 && tab === "graph") {
    return (
      <View style={{ gap: 12 }}>
        <ArchTabs tab={tab} setTab={setTab} hasGraph={!!graphB64} />
        <Panel title="Dependency graph" subtitle="interactive — filter, search, click nodes (from `graph render`)">
          <DependencyGraph b64={graphB64} width={Math.max(360, width - 60)} />
        </Panel>
      </View>
    );
  }

  if (pkgs.length < 2) {
    if (graphB64) {
      // No package structure, but we can still offer the file-level graph.
      return (
        <View style={{ gap: 12 }}>
          <ArchTabs tab={tab} setTab={setTab} hasGraph={!!graphB64} />
          <Panel title="Architecture" subtitle="no multi-package main sequence — see the Dependency graph tab">
            <EmptyState
              icon={Network as any}
              title="No package structure"
              description="This repo has no connected multi-package boundaries for a main sequence, but the file-level dependency graph is available in the Dependency graph tab."
            />
          </Panel>
        </View>
      );
    }
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
    <View style={{ gap: 12 }}>
      {graphB64 ? <ArchTabs tab={tab} setTab={setTab} hasGraph /> : null}
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
    </View>
  );
}

function ArchTabs({ tab, setTab, hasGraph }: { tab: ArchTab; setTab: (t: ArchTab) => void; hasGraph: boolean }) {
  if (!hasGraph) return null;
  const Tab = ({ id, label }: { id: ArchTab; label: string }) => (
    <Pressable onPress={() => setTab(id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: tab === id ? cw.raised : "transparent", borderWidth: 1, borderColor: tab === id ? cw.border : "transparent" }}>
      <Text style={{ color: tab === id ? cw.text : cw.textDim, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Tab id="sequence" label="Main sequence" />
      <Tab id="graph" label="Dependency graph" />
    </View>
  );
}

function DependencyGraph({ b64, width }: { b64: string; width: number }) {
  // react-native-web renders to the DOM, so a raw <iframe> via createElement
  // works; a data-URI carries the whole self-contained render HTML.
  return React.createElement("iframe", {
    src: `data:text/html;base64,${b64}`,
    title: "dependency graph",
    style: { width, height: 620, border: "0", borderRadius: 8, background: "#0f1419" },
  });
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: cw.textFaint, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
