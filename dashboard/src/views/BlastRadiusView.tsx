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
import { cw, shortId, pkgOf } from "../theme";

type SortKey = "score" | "utilization" | "complexity" | "churn";

/**
 * Blast radius (C-53): exports ranked by utilization × file complexity × file
 * churn. The riskiest thing to touch is a heavily-used export in a file that is
 * both hard to reason about and actively changing — this pinpoints WHICH export
 * (not just which file) carries that combined risk. Empty is a good sign: no
 * load-bearing export lives in a volatile, complex file.
 */
export function BlastRadiusView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [pkg, setPkg] = useState<string>("all");
  const all = data.blastRadius ?? [];

  const packages = useMemo(
    () => ["all", ...Array.from(new Set(all.map((e) => pkgOf(e.fileId)))).sort()],
    [all],
  );

  const rows = useMemo(() => {
    let r = all;
    if (pkg !== "all") r = r.filter((e) => pkgOf(e.fileId) === pkg);
    return [...r].sort((a, b) => b[sort] - a[sort]);
  }, [all, pkg, sort]);

  const maxScore = Math.max(1, ...rows.map((r) => r.score));

  return (
    <View style={{ gap: 16 }}>
      {packages.length > 1 ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Text style={{ color: cw.textDim, fontSize: 12 }}>package:</Text>
          {packages.map((p) => (
            <Pressable key={p} onPress={() => setPkg(p)}>
              <Pillet text={p} color={p === pkg ? cw.brand : cw.textFaint} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Panel
        title="Blast radius"
        subtitle="score = utilization × file complexity × file churn · the riskiest export to change · click a column to sort"
      >
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Export</TableHeaderCell>
                <SortCol label="Util" width={70} active={sort === "utilization"} onPress={() => setSort("utilization")} />
                <SortCol label="Complexity" width={100} active={sort === "complexity"} onPress={() => setSort("complexity")} />
                <SortCol label="Churn" width={80} active={sort === "churn"} onPress={() => setSort("churn")} />
                <SortCol label="Blast" width={170} active={sort === "score"} onPress={() => setSort("score")} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.symbolId} isHoverable>
                  <TableCell style={{ flex: 1, minWidth: 0 }}>
                    <Pressable onPress={() => onSelect(e.fileId)} style={{ alignSelf: "stretch", minWidth: 0 }}>
                      <Text style={{ color: cw.text, fontSize: 13, fontFamily: "monospace" } as any} numberOfLines={1}>{e.name}</Text>
                      <Text style={{ color: cw.textFaint, fontSize: 11 }} numberOfLines={1}>{shortId(e.fileId)}</Text>
                    </Pressable>
                  </TableCell>
                  <TableCell align="right" width={70}><Text style={{ color: cw.info, fontSize: 13, fontWeight: "700" }}>{Math.round(e.utilization)}</Text></TableCell>
                  <TableCell align="right" width={100}><Text style={{ color: cw.textDim, fontSize: 13 }}>{e.complexity}</Text></TableCell>
                  <TableCell align="right" width={80}><Text style={{ color: cw.textDim, fontSize: 13 }}>{e.churn}</Text></TableCell>
                  <TableCell align="right" width={170}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <Bar frac={e.score / maxScore} color={cw.warning} width={70} />
                      <Text style={{ color: cw.text, fontSize: 13, width: 56, textAlign: "right" }}>{Math.round(e.score)}</Text>
                    </View>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text style={{ color: cw.textFaint, fontSize: 13 }}>
            No high-blast-radius exports — load-bearing exports live in stable, simple files. That's a healthy sign.
          </Text>
        )}
      </Panel>
    </View>
  );
}

function SortCol({ label, active, onPress, width }: { label: string; active: boolean; onPress: () => void; width: number }) {
  return (
    <TableHeaderCell align="right" onPress={onPress} width={width}>
      <Text style={{ color: active ? cw.brand : cw.textDim, fontSize: 12, fontWeight: "600" }}>
        {label}{active ? " ↓" : ""}
      </Text>
    </TableHeaderCell>
  );
}
