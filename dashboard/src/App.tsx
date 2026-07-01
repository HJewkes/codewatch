import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import {
  Sidebar,
  SidebarHeader,
  SidebarItem,
  Button,
  ButtonText,
  Typography,
} from "@titan-design/react-ui";
import { LayoutDashboard, Flame, ShieldAlert, Users, GitFork } from "lucide-react";
import type { CodewatchData } from "./types";
import { cw, shortId, pkgOf, pct } from "./theme";
import { Pillet } from "./components/primitives";
import { OverviewView } from "./views/OverviewView";
import { HotspotsView } from "./views/HotspotsView";
import { FitnessView } from "./views/FitnessView";
import { OwnershipView } from "./views/OwnershipView";

type ViewId = "overview" | "hotspots" | "fitness" | "ownership";

const NAV: { id: ViewId; label: string; icon: any }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "hotspots", label: "Hotspots", icon: Flame },
  { id: "fitness", label: "Fitness", icon: ShieldAlert },
  { id: "ownership", label: "Ownership", icon: Users },
];

function useViewport() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function App({ data }: { data: CodewatchData }) {
  const [view, setView] = useState<ViewId>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const vw = useViewport();
  const contentW = vw - 240 - (selected ? 340 : 0);

  const openViolationForNode = (id: string) => data.violations.filter((v) => v.file === id);

  return (
    <View style={{ flexDirection: "row", height: "100vh" as any, backgroundColor: cw.bg }}>
      <Sidebar activeItem={view} onItemSelect={(id) => setView(id as ViewId)} width={240} style={{ backgroundColor: cw.surface, borderRightWidth: 1, borderRightColor: cw.border }}>
        <SidebarHeader>
          <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: cw.brand, fontWeight: "800", fontSize: 18 }}>codewatch</Text>
            <Text style={{ color: cw.textFaint, fontSize: 11 }}>{data.meta.repo} · snap {data.meta.snapshotId}</Text>
          </View>
        </SidebarHeader>
        {NAV.map((n) => (
          <SidebarItem key={n.id} id={n.id} label={n.label} icon={n.icon as any} />
        ))}
      </Sidebar>

      <View style={{ flex: 1 }}>
        <TopBar data={data} view={view} />
        <View style={{ flexDirection: "row", flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {view === "overview" && <OverviewView data={data} onSelect={setSelected} width={contentW} />}
            {view === "hotspots" && <HotspotsView data={data} onSelect={setSelected} width={contentW} />}
            {view === "fitness" && <FitnessView data={data} onSelect={setSelected} />}
            {view === "ownership" && <OwnershipView data={data} onSelect={setSelected} />}
          </ScrollView>
          {selected ? (
            <Dossier
              id={selected}
              data={data}
              violations={openViolationForNode(selected)}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function TopBar({ data, view }: { data: CodewatchData; view: string }) {
  const [copied, setCopied] = useState(false);
  const copyJson = () => {
    try {
      navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked under file:// */
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: cw.border, backgroundColor: cw.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ color: cw.text, fontSize: 18, fontWeight: "700", textTransform: "capitalize" }}>{view}</Text>
        <Pillet text={`${data.meta.windowDays}d window`} color={cw.info} />
        <Pillet text={`v${data.meta.indexVersion ?? "?"}`} color={cw.textFaint} />
        {data.meta.baseline ? <Pillet text={`vs ${data.meta.baseline.ref}`} color={cw.textFaint} /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Text style={{ color: cw.textFaint, fontSize: 11 }}>{data.meta.fileCount ?? "?"} files</Text>
        <Button variant="outline" color="secondary" size="sm" onPress={copyJson}>
          <ButtonText>{copied ? "copied ✓" : "Copy JSON"}</ButtonText>
        </Button>
      </View>
    </View>
  );
}

function Dossier({ id, data, violations, onClose }: { id: string; data: CodewatchData; violations: CodewatchData["violations"]; onClose: () => void }) {
  const hotspot = data.hotspots.find((h) => h.nodeId === id);
  const bus = data.busFactorRisks.find((b) => b.nodeId === id);
  const central = data.centralFiles.find((c) => c.nodeId === id);
  const coupled = data.couplingClusters.filter((c) => c.a === id || c.b === id);
  return (
    <View style={{ width: 340, backgroundColor: cw.surface, borderLeftWidth: 1, borderLeftColor: cw.border, padding: 16, gap: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: cw.textFaint, fontSize: 11 }}>{pkgOf(id)}</Text>
          <Text style={{ color: cw.text, fontSize: 14, fontWeight: "700" }}>{id.split("/").pop()}</Text>
        </View>
        <Pressable onPress={onClose}><Text style={{ color: cw.textDim, fontSize: 18 }}>×</Text></Pressable>
      </View>
      <Text style={{ color: cw.textFaint, fontSize: 11 }} numberOfLines={2}>{id}</Text>

      <DossierRow label="Churn × complexity" value={hotspot ? `${hotspot.churn} × ${hotspot.complexity} = ${hotspot.score}` : "—"} />
      <DossierRow label="Bus factor" value={bus ? `1 (${pct(bus.topAuthorShare)} top author)` : "—"} />
      <DossierRow label="Centrality (PageRank)" value={central ? central.score.toFixed(4) : "—"} />

      {coupled.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: cw.textDim, fontSize: 12, fontWeight: "600" }}>Change-coupled with</Text>
          {coupled.map((c) => {
            const other = c.a === id ? c.b : c.a;
            return (
              <View key={other} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: cw.text, fontSize: 12 }} numberOfLines={1}>{shortId(other)}</Text>
                <Text style={{ color: c.hidden ? cw.warning : cw.textFaint, fontSize: 11 }}>{c.hidden ? "hidden ×" : "×"}{c.coEdits}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {violations.length ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: cw.error, fontSize: 12, fontWeight: "600" }}>{violations.length} violation(s)</Text>
          {violations.map((v, i) => (
            <Text key={i} style={{ color: cw.textFaint, fontSize: 11 }}>{v.rule}: {v.detail}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DossierRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: cw.textDim, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: cw.text, fontSize: 13, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}
