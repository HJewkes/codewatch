import React from "react";
import { View, Text, Pressable } from "react-native";
import { Alert, AlertTitle, AlertDescription } from "@titan-design/react-ui";
import type { CodewatchData } from "../types";
import { Panel, Bar } from "../components/primitives";
import { cw, shortId, pct } from "../theme";

export function OwnershipView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const singleAuthor = data.meta.authorCount === 1;
  return (
    <View style={{ gap: 16 }}>
      {singleAuthor ? (
        <Alert status="info" variant="subtle">
          <AlertTitle>Single-author repository</AlertTitle>
          <AlertDescription>
            Every file has bus factor 1 by definition — ownership concentration isn't a
            distinguishing signal here. Shown for completeness.
          </AlertDescription>
        </Alert>
      ) : null}
      <Panel title="Knowledge silos" subtitle="single-owner files, ranked by churn">
        {data.busFactorRisks.length === 0 ? (
          <Text style={{ color: cw.textFaint }}>No single-owner files in the window.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {data.busFactorRisks.map((b) => (
              <Pressable key={b.nodeId} onPress={() => onSelect(b.nodeId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(b.nodeId)}</Text>
                </View>
                <Bar frac={b.topAuthorShare} color={cw.error} />
                <Text style={{ color: cw.textDim, fontSize: 12, width: 42, textAlign: "right" }}>{pct(b.topAuthorShare)}</Text>
                <Text style={{ color: cw.textFaint, fontSize: 12, width: 54, textAlign: "right" }}>churn {b.churn}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Panel>
    </View>
  );
}
