import React, { useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@titan-design/react-ui";
import type { CodewatchData } from "../types";
import { Panel, Bar, Pillet } from "../components/primitives";
import { Treemap } from "../components/Treemap";
import { cw, hotspotColor, shortId, pkgOf } from "../theme";

type SortKey = "score" | "churn" | "complexity";

export function HotspotsView({ data, onSelect, width }: { data: CodewatchData; onSelect: (id: string) => void; width: number }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [pkg, setPkg] = useState<string>("all");

  const packages = useMemo(
    () => ["all", ...Array.from(new Set(data.hotspots.map((h) => pkgOf(h.nodeId)))).sort()],
    [data.hotspots],
  );

  const rows = useMemo(() => {
    let r = data.hotspots;
    if (pkg !== "all") r = r.filter((h) => pkgOf(h.nodeId) === pkg);
    return [...r].sort((a, b) => b[sort] - a[sort]);
  }, [data.hotspots, pkg, sort]);

  const tmData = rows.map((h) => ({ id: h.nodeId, value: h.score, color: hotspotColor(h.score), label: h.nodeId.split("/").pop() }));
  const maxScore = Math.max(1, ...rows.map((r) => r.score));

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Text style={{ color: cw.textDim, fontSize: 12 }}>package:</Text>
        {packages.map((p) => (
          <Pressable key={p} onPress={() => setPkg(p)}>
            <Pillet text={p} color={p === pkg ? cw.brand : cw.textFaint} />
          </Pressable>
        ))}
      </View>

      <Panel title="Hotspot map" subtitle={`${rows.length} files · area = severity`}>
        {tmData.length ? (
          <Treemap data={tmData} width={Math.min(width - 80, 900)} height={200} onSelect={onSelect} maxTiles={60} />
        ) : (
          <Text style={{ color: cw.textFaint }}>No hotspots for this filter.</Text>
        )}
      </Panel>

      <Panel title="Hotspots" subtitle="churn × complexity — click a column to sort">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>File</TableHeaderCell>
              <SortCol label="Churn" active={sort === "churn"} onPress={() => setSort("churn")} />
              <SortCol label="Complexity" active={sort === "complexity"} onPress={() => setSort("complexity")} />
              <SortCol label="Score" active={sort === "score"} onPress={() => setSort("score")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={h.nodeId} isHoverable>
                <TableCell>
                  <Pressable onPress={() => onSelect(h.nodeId)}>
                    <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(h.nodeId)}</Text>
                  </Pressable>
                </TableCell>
                <TableCell align="right"><Text style={{ color: cw.textDim, fontSize: 13 }}>{h.churn}</Text></TableCell>
                <TableCell align="right"><Text style={{ color: cw.textDim, fontSize: 13 }}>{h.complexity}</Text></TableCell>
                <TableCell align="right">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                    <Bar frac={h.score / maxScore} color={hotspotColor(h.score)} width={70} />
                    <Text style={{ color: cw.text, fontSize: 13, width: 46, textAlign: "right" }}>{h.score}</Text>
                  </View>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </View>
  );
}

function SortCol({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TableHeaderCell align="right" onPress={onPress}>
      <Text style={{ color: active ? cw.brand : cw.textDim, fontSize: 12, fontWeight: "600" }}>
        {label}{active ? " ↓" : ""}
      </Text>
    </TableHeaderCell>
  );
}
