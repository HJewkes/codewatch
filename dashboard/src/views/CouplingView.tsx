import React from "react";
import { View, Text, Pressable } from "react-native";
import { EmptyState } from "@titan-design/react-ui";
import { Link2, ShieldCheck } from "lucide-react";
import type {
  CodewatchData,
  CouplingPair,
  SymbolCouplingRow,
  SymbolConsumerGroup,
} from "../types";
import { Panel, Bar, Pillet } from "../components/primitives";
import { cw, shortId } from "../theme";

export function CouplingView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const pairs = [...data.couplingClusters].sort((a, b) => b.coEdits - a.coEdits);
  const hidden = pairs.filter((p) => p.hidden);
  const unverifiable = pairs.filter((p) => p.unindexed);
  const expected = pairs.filter((p) => !p.hidden && !p.unindexed);
  const maxCoEdits = Math.max(1, ...pairs.map((p) => p.coEdits));
  const symbolCoupling = data.symbolCoupling ?? [];
  const consumerGroups = data.symbolConsumers ?? [];

  if (pairs.length === 0 && symbolCoupling.length === 0 && consumerGroups.length === 0) {
    return (
      <Panel title="Change coupling" subtitle="what couples to what">
        <EmptyState
          icon={Link2 as any}
          title="No coupling in the window"
          description="Symbol co-imports and files co-edited in ≥2 commits appear here. A dormant or very fresh window shows nothing."
        />
      </Panel>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {/* Lead with symbol-level signal: which export goes where, and which
          symbols travel together — a god-file (types.ts) decomposed, not one
          aggregate node. This is structural (used-together) coupling. */}
      {consumerGroups.length ? (
        <Panel
          title="What's used where"
          subtitle="each shared export and the files that import it — the god-file decomposed by symbol"
        >
          <ConsumerGroups groups={consumerGroups} onSelect={onSelect} />
        </Panel>
      ) : null}

      {symbolCoupling.length ? (
        <Panel
          title="Symbols that travel together"
          subtitle="pairs consistently co-imported by the same files — structural coupling the file view hides"
        >
          <SymbolCouplingList rows={symbolCoupling} onSelect={onSelect} />
        </Panel>
      ) : null}

      {/* File-level temporal (git co-change) coupling, demoted below the
          structural symbol signal. Actionable case first: co-change with no
          import between them. */}
      <Panel
        title="Hidden coupling"
        subtitle="files that change together but with no import between them — an undocumented dependency or missing abstraction"
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

      {expected.length ? (
        <Panel title="Expected co-change" subtitle="import-backed pairs that change together — usually fine">
          <PairList pairs={expected} maxCoEdits={maxCoEdits} onSelect={onSelect} tone="expected" />
        </Panel>
      ) : null}

      {unverifiable.length ? (
        <Panel title="Unverifiable" subtitle="a file has no resolved imports in the graph, so whether an import backs this co-change can't be determined">
          <PairList pairs={unverifiable} maxCoEdits={maxCoEdits} onSelect={onSelect} tone="expected" />
        </Panel>
      ) : null}
    </View>
  );
}

/** Slice C: per-file groups of exported symbols and the files that consume them. */
function ConsumerGroups({
  groups,
  onSelect,
}: {
  groups: SymbolConsumerGroup[];
  onSelect: (id: string) => void;
}) {
  return (
    <View style={{ gap: 14 }}>
      {groups.map((g) => (
        <View key={g.fileId} style={{ gap: 6 }}>
          <Pressable onPress={() => onSelect(g.fileId)}>
            <Text style={{ color: cw.textDim, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
              {shortId(g.fileId)}
            </Text>
          </Pressable>
          {g.symbols.map((s) => (
            <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: cw.text, fontSize: 13, fontWeight: "600", minWidth: 120 }} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={{ color: cw.textFaint, fontSize: 12 }}>→</Text>
              {s.consumers.slice(0, 5).map((c) => (
                <Pressable key={c} onPress={() => onSelect(c)}>
                  <Pillet text={shortId(c)} color={cw.info} />
                </Pressable>
              ))}
              {s.consumerCount > Math.min(5, s.consumers.length) ? (
                <Text style={{ color: cw.textFaint, fontSize: 12 }}>
                  +{s.consumerCount - Math.min(5, s.consumers.length)} more
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Slice B: symbol pairs consistently co-imported by the same files. */
function SymbolCouplingList({
  rows,
  onSelect,
}: {
  rows: SymbolCouplingRow[];
  onSelect: (id: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.coImports));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r) => (
        <View
          key={r.aFile + r.aName + r.bFile + r.bName}
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <SymbolRef file={r.aFile} name={r.aName} onSelect={onSelect} />
          <Text style={{ color: cw.textFaint }}>↔</Text>
          <SymbolRef file={r.bFile} name={r.bName} onSelect={onSelect} />
          {r.crossFile ? <Pillet text="cross-file" color={cw.warning} /> : null}
          <Bar frac={r.coImports / max} color={r.crossFile ? cw.warning : cw.textFaint} width={70} />
          <Text style={{ color: cw.textDim, fontSize: 12, width: 34, textAlign: "right" }}>×{r.coImports}</Text>
        </View>
      ))}
    </View>
  );
}

function SymbolRef({
  file,
  name,
  onSelect,
}: {
  file: string;
  name: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Pressable style={{ flex: 1 }} onPress={() => onSelect(file)}>
      <Text style={{ color: cw.text, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{name}</Text>
      <Text style={{ color: cw.textFaint, fontSize: 11 }} numberOfLines={1}>{shortId(file)}</Text>
    </Pressable>
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
