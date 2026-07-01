import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Scatter, EmptyState } from "@titan-design/react-ui";
import { Network } from "lucide-react";
import type { CodewatchData, PackageStat } from "../types";
import { Panel, Pillet } from "../components/primitives";
import { loadGraphHtml } from "../data";
import { cw } from "../theme";

/**
 * Cohesion band. Cohesion (LCOM-derived, 0..1, higher = more focused) is the
 * real signal — a low-cohesion package is doing too much. Replaces the old
 * abstractness proxy, which was pinned in a narrow range and made the scatter
 * 1-D. A "doing too much" verdict is only meaningful with cross-package reach,
 * so we lean on crossEdges to corroborate it.
 */
function cohesionBand(p: PackageStat): { label: string; color: string } {
  if (p.cohesion >= 0.85) return { label: "focused", color: cw.success };
  if (p.cohesion >= 0.7) return { label: "moderate", color: cw.info };
  return { label: "doing too much", color: cw.warning };
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
      <Panel title="Architecture" subtitle="package structure map (instability × cohesion)">
        <EmptyState
          icon={Network as any}
          title="No package structure"
          description="This repo has no connected multi-package boundaries to plot (a flat src/ tree). The structure map needs ≥2 packages with cross-package dependencies."
        />
      </Panel>
    );
  }

  const maxFiles = Math.max(...pkgs.map((p) => p.fileCount));
  const points = pkgs.map((p) => ({
    id: p.pkgId,
    x: p.instability,
    y: p.cohesion,
    r: 6 + Math.sqrt(p.fileCount / maxFiles) * 16,
    color: cohesionBand(p).color,
    label: p.pkgId.replace(/^packages\//, ""),
  }));
  const plotW = Math.max(360, Math.min(width - 360, 620));
  // Lowest cohesion first — the packages doing too much are the ones to look at.
  const ranked = [...pkgs].sort((a, b) => a.cohesion - b.cohesion);

  return (
    <View style={{ gap: 12 }}>
      {graphB64 ? <ArchTabs tab={tab} setTab={setTab} hasGraph /> : null}
      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
      <Panel title="Structure map" subtitle="instability I × cohesion; low + wide-reaching = doing too much">
        <Scatter
          data={points}
          width={plotW}
          height={Math.min(plotW, 420)}
          axis={{ xLabel: "Instability →", yLabel: "Cohesion →", xMin: 0, xMax: 1, yMin: 0, yMax: 1 }}
          onPress={onSelect}
        />
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
          <Legend color={cw.success} label="focused (≥0.85)" />
          <Legend color={cw.info} label="moderate (≥0.70)" />
          <Legend color={cw.warning} label="doing too much" />
        </View>
      </Panel>

      <Panel title="Packages" subtitle="ranked by lowest cohesion" flex={1}>
        <View style={{ gap: 8 }}>
          {ranked.map((p) => {
            const z = cohesionBand(p);
            // "rigid" was an abstractness artefact that libelled healthy
            // foundation packages; foundation being stable is by design.
            const foundation = p.layer === "foundation";
            return (
              <Pressable key={p.pkgId} onPress={() => onSelect(p.pkgId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: cw.text, fontSize: 13 }}>{p.pkgId.replace(/^packages\//, "")}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                    <Pillet text={p.layer} color={foundation ? cw.success : cw.info} />
                    <Pillet text={z.label} color={z.color} />
                    {p.crossEdges ? <Pillet text={`${p.crossEdges} cross-edges`} color={cw.textFaint} /> : null}
                  </View>
                </View>
                <Text style={{ color: cw.textDim, fontSize: 12, width: 96, textAlign: "right" }}>
                  I {p.instability.toFixed(2)}
                </Text>
                <Text style={{ color: z.color, fontSize: 12, width: 52, textAlign: "right" }}>coh {p.cohesion.toFixed(2)}</Text>
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
