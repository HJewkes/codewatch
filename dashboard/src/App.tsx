import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput } from "react-native";
import {
  Sidebar,
  SidebarHeader,
  SidebarItem,
  Button,
  ButtonText,
} from "@titan-design/react-ui";
import { LayoutDashboard, Flame, Network, ShieldAlert, Users, GitFork, GitCompareArrows } from "lucide-react";
import type { CodewatchData, NodeMetrics } from "./types";
import { cw, shortId, pkgOf, hotspotColor, metricHeat, METRIC_BUDGET, tint, severityColor } from "./theme";
import { Pillet } from "./components/primitives";
import { loadWindows } from "./data";
import { OverviewView } from "./views/OverviewView";
import { HotspotsView } from "./views/HotspotsView";
import { ArchitectureView } from "./views/ArchitectureView";
import { FitnessView } from "./views/FitnessView";
import { OwnershipView } from "./views/OwnershipView";
import { CouplingView } from "./views/CouplingView";
import { DriftView } from "./views/DriftView";

type ViewId = "overview" | "hotspots" | "architecture" | "coupling" | "ownership" | "fitness" | "drift";

const NAV: { id: ViewId; label: string; icon: any }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "hotspots", label: "Hotspots", icon: Flame },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "coupling", label: "Coupling", icon: GitFork },
  { id: "ownership", label: "Ownership", icon: Users },
  { id: "fitness", label: "Fitness", icon: ShieldAlert },
  { id: "drift", label: "Drift", icon: GitCompareArrows },
];
const VIEW_IDS = NAV.map((n) => n.id);

function useViewport() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

interface Loc {
  view: ViewId;
  node: string | null;
  q: string;
  w: string | null;
}

function parseHash(): Loc {
  const raw = window.location.hash.replace(/^#/, "");
  const [viewPart, queryPart] = raw.split("?");
  const params = new URLSearchParams(queryPart ?? "");
  const view = (VIEW_IDS as string[]).includes(viewPart) ? (viewPart as ViewId) : "overview";
  return { view, node: params.get("node"), q: params.get("q") ?? "", w: params.get("w") };
}

function writeHash(loc: Loc) {
  const params = new URLSearchParams();
  if (loc.node) params.set("node", loc.node);
  if (loc.q) params.set("q", loc.q);
  if (loc.w) params.set("w", loc.w);
  const qs = params.toString();
  const next = `#${loc.view}${qs ? "?" + qs : ""}`;
  if (next === window.location.hash) return;
  // Push on a view change so Back works; replace for search/selection churn.
  const prevView = window.location.hash.replace(/^#/, "").split("?")[0];
  if (prevView !== loc.view) window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

/** Narrow the row-heavy sections by a path substring; KPIs stay whole. */
function applyQuery(data: CodewatchData, q: string): CodewatchData {
  if (!q) return data;
  const m = (id: string) => id.toLowerCase().includes(q.toLowerCase());
  return {
    ...data,
    hotspots: data.hotspots.filter((h) => m(h.nodeId)),
    busFactorRisks: data.busFactorRisks.filter((b) => m(b.nodeId)),
    couplingClusters: data.couplingClusters.filter((c) => m(c.a) || m(c.b)),
    centralFiles: data.centralFiles.filter((c) => m(c.nodeId)),
    violations: data.violations.filter((v) => m(v.file)),
    drift: data.drift && {
      ...data.drift,
      newHotspots: data.drift.newHotspots.filter((h) => m(h.nodeId)),
      worsened: data.drift.worsened.filter((d) => m(d.nodeId)),
      improved: data.drift.improved.filter((d) => m(d.nodeId)),
      resolved: data.drift.resolved.filter((d) => m(d.nodeId)),
      newSilos: data.drift.newSilos.filter(m),
      newCoupling: data.drift.newCoupling.filter((c) => m(c.a) || m(c.b)),
    },
  };
}

export function App({ data }: { data: CodewatchData }) {
  const [loc, setLoc] = useState<Loc>(() => parseHash());
  const windows = useRef(loadWindows()).current;
  const windowKey = (windows && loc.w && windows[loc.w] ? loc.w : String(data.meta.windowDays));
  const active = (windows && windows[windowKey]) ?? data;
  const vw = useViewport();
  const searchRef = useRef<TextInput>(null);
  const contentW = vw - 240 - (loc.node ? 340 : 0);

  const update = (patch: Partial<Loc>) => setLoc((prev) => ({ ...prev, ...patch }));
  const setView = (view: ViewId) => update({ view });
  const setSelected = (node: string | null) => update({ node });

  useEffect(() => writeHash(loc), [loc]);
  useEffect(() => {
    const onHash = () => setLoc(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard: 1-6 switch views, / focuses search, Esc clears selection/search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (e.key === "Escape") {
        setLoc((p) => ({ ...p, node: null, q: "" }));
        (e.target as HTMLElement)?.blur?.();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) setView(NAV[n - 1].id);
    };
    // Capture phase so Escape reaches us before the focused TextInput swallows it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const view = applyQuery(active, loc.q);
  const openViolationForNode = (id: string) => active.violations.filter((v) => v.file === id);

  return (
    <View style={{ flexDirection: "row", height: "100vh" as any, backgroundColor: cw.bg }}>
      <Sidebar activeItem={loc.view} onItemSelect={(id) => setView(id as ViewId)} width={240} style={{ backgroundColor: cw.surface, borderRightWidth: 1, borderRightColor: cw.border }}>
        <SidebarHeader>
          <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: cw.brand, fontWeight: "800", fontSize: 18 }}>codewatch</Text>
            <Text style={{ color: cw.textFaint, fontSize: 11 }}>{active.meta.repo} · snap {active.meta.snapshotId}</Text>
          </View>
        </SidebarHeader>
        {NAV.map((n) => (
          <SidebarItem key={n.id} id={n.id} label={n.label} icon={n.icon as any} />
        ))}
      </Sidebar>

      <View style={{ flex: 1 }}>
        <TopBar
          data={active}
          view={loc.view}
          q={loc.q}
          onQuery={(q) => update({ q })}
          searchRef={searchRef}
          windowKeys={windows ? Object.keys(windows).sort((a, b) => Number(a) - Number(b)) : []}
          windowKey={windowKey}
          onWindow={(w) => update({ w })}
        />
        <View style={{ flexDirection: "row", flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {loc.view === "overview" && <OverviewView data={view} onSelect={setSelected} width={contentW} />}
            {loc.view === "hotspots" && <HotspotsView data={view} onSelect={setSelected} width={contentW} />}
            {loc.view === "architecture" && <ArchitectureView data={active} onSelect={setSelected} width={contentW} />}
            {loc.view === "coupling" && <CouplingView data={view} onSelect={setSelected} />}
            {loc.view === "ownership" && <OwnershipView data={view} onSelect={setSelected} />}
            {loc.view === "fitness" && <FitnessView data={view} onSelect={setSelected} query={loc.q} />}
            {loc.view === "drift" && <DriftView data={view} onSelect={setSelected} />}
          </ScrollView>
          {loc.node ? (
            <Dossier id={loc.node} data={active} violations={openViolationForNode(loc.node)} onClose={() => setSelected(null)} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function TopBar({ data, view, q, onQuery, searchRef, windowKeys, windowKey, onWindow }: { data: CodewatchData; view: string; q: string; onQuery: (q: string) => void; searchRef: React.RefObject<TextInput | null>; windowKeys: string[]; windowKey: string; onWindow: (k: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copyJson = () => {
    try {
      navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked under file:// */ }
  };
  const multiWindow = windowKeys.length > 1;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: cw.border, backgroundColor: cw.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ color: cw.text, fontSize: 18, fontWeight: "700", textTransform: "capitalize" }}>{view}</Text>
        {multiWindow ? (
          <View style={{ flexDirection: "row", gap: 4 }}>
            {windowKeys.map((k) => (
              <Pressable key={k} onPress={() => onWindow(k)}>
                <Pillet text={`${k}d`} color={k === windowKey ? cw.brand : cw.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Pillet text={`${data.meta.windowDays}d window`} color={cw.info} />
        )}
        <Pillet text={`v${data.meta.indexVersion ?? "?"}`} color={cw.textFaint} />
        {data.meta.baseline ? <Pillet text={`vs ${data.meta.baseline.ref}`} color={cw.textFaint} /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <TextInput
          ref={searchRef}
          value={q}
          onChangeText={onQuery}
          placeholder="Filter files  ( / )"
          placeholderTextColor={cw.textFaint}
          style={{ width: 220, height: 32, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: cw.border, backgroundColor: cw.surface, color: cw.text, fontSize: 13 } as any}
        />
        <Button variant="outline" color="secondary" size="sm" onPress={copyJson}>
          <ButtonText>{copied ? "copied ✓" : "Copy JSON"}</ButtonText>
        </Button>
      </View>
    </View>
  );
}

function Dossier({ id, data, violations, onClose }: { id: string; data: CodewatchData; violations: CodewatchData["violations"]; onClose: () => void }) {
  const hotspot = data.hotspots.find((h) => h.nodeId === id);
  const central = data.centralFiles.find((c) => c.nodeId === id);
  const coupled = data.couplingClusters.filter((c) => c.a === id || c.b === id);
  const metrics = data.nodeMetrics?.[id];
  return (
    <ScrollView style={{ width: 340, backgroundColor: cw.surface, borderLeftWidth: 1, borderLeftColor: cw.border }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: cw.textFaint, fontSize: 11 }}>{pkgOf(id)}</Text>
          <Text style={{ color: cw.text, fontSize: 14, fontWeight: "700" }}>{id.split("/").pop()}</Text>
        </View>
        <Pressable onPress={onClose}><Text style={{ color: cw.textDim, fontSize: 18 }}>×</Text></Pressable>
      </View>
      <Text style={{ color: cw.textFaint, fontSize: 11 }} numberOfLines={2}>{id}</Text>
      {metrics ? <MetricReadout m={metrics} /> : null}
      <DossierRow
        label="Hotspot score"
        value={hotspot ? hotspotBreakdown(hotspot) : "—"}
        valueColor={hotspot ? hotspotColor(hotspot.score) : undefined}
      />
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
            <Text key={i} style={{ fontSize: 11 }}>
              <Text style={{ color: severityColor(v.severity), fontWeight: "600" }}>{v.rule}</Text>
              <Text style={{ color: cw.textFaint }}>: {v.detail}</Text>
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Per-metric labels + the fitness-budget key that anchors each row's heat. */
const METRIC_ROWS: { key: keyof NodeMetrics; label: string; budgetKey?: string }[] = [
  { key: "loc", label: "Lines of code", budgetKey: "loc" },
  { key: "cognitiveMax", label: "Cognitive (max fn)", budgetKey: "cognitive_max" },
  { key: "cyclomaticMax", label: "Cyclomatic (max fn)", budgetKey: "cyclomatic_max" },
  { key: "maxNesting", label: "Nesting depth", budgetKey: "max_nesting_depth" },
  { key: "fanOut", label: "Fan-out", budgetKey: "fan_out" },
  { key: "fanIn", label: "Fan-in" },
];

/**
 * Heat-colored structural readout: each metric is colored + bar-scaled against the
 * repo's own fitness budget, so the drawer shows at a glance which dimension pushes
 * a file toward (or over) a rule. Fan-in has no budget — shown neutral, no bar.
 */
function MetricReadout({ m }: { m: NodeMetrics }) {
  const rows = METRIC_ROWS.filter((r) => m[r.key] !== undefined);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: cw.textDim, fontSize: 12, fontWeight: "600" }}>Structural metrics</Text>
      {rows.map((r) => {
        const value = m[r.key] as number;
        const budget = r.budgetKey ? METRIC_BUDGET[r.budgetKey] : undefined;
        const color = metricHeat(value, budget);
        const ratio = budget ? Math.min(1, value / budget) : 0;
        return (
          <View key={r.key} style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={{ color: cw.textDim, fontSize: 12 }}>{r.label}</Text>
              <Text style={{ fontSize: 12 }}>
                <Text style={{ color, fontWeight: "700" }}>{value}</Text>
                {budget !== undefined ? <Text style={{ color: cw.textFaint }}> / {budget}</Text> : null}
              </Text>
            </View>
            {budget !== undefined ? (
              <View style={{ height: 3, borderRadius: 2, backgroundColor: tint(cw.textFaint, 0.25), overflow: "hidden" }}>
                <View style={{ height: 3, width: `${ratio * 100}%`, backgroundColor: color, borderRadius: 2 }} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** "churn × complexity = score", inserting the recency factor only when it discounts. */
function hotspotBreakdown(h: { churn: number; complexity: number; score: number; recency?: number }): string {
  const discounted = h.recency !== undefined && h.recency < 1;
  const factors = discounted ? `${h.churn} × ${h.complexity} × ${h.recency}` : `${h.churn} × ${h.complexity}`;
  return `${factors} = ${h.score}`;
}

function DossierRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: cw.textDim, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: valueColor ?? cw.text, fontSize: 13, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}
