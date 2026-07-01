import React from "react";
import { View, Text, Pressable } from "react-native";
import { Alert, AlertTitle, AlertDescription } from "@titan-design/react-ui";
import type { CodewatchData, TestCoverageRisk } from "../types";
import { Panel, Bar } from "../components/primitives";
import { cw, shortId, pct } from "../theme";

export function OwnershipView({ data, onSelect }: { data: CodewatchData; onSelect: (id: string) => void }) {
  const singleAuthor = data.meta.authorCount === 1;
  const testRisks = data.testCoverageRisks ?? [];

  // On a single-author repo, authorship bus factor is 1 everywhere by
  // construction — for production AND test churn — so the "knowledge silos"
  // table is a constant, not a signal. The one non-degenerate ownership-adjacent
  // signal that survives is coverage BREADTH: how many test files touch each
  // source. So swap the degenerate authorship table for a coverage-breadth view.
  if (singleAuthor) {
    return (
      <View style={{ gap: 16 }}>
        <Alert status="info" variant="subtle">
          <AlertTitle>Single-author repository — ownership concentration is N/A</AlertTitle>
          <AlertDescription>
            Every file (and its tests) has bus factor 1 by definition, so authorship
            silos aren't a distinguishing signal here. Showing test-coverage breadth
            instead — the sources with the fewest test files covering them.
          </AlertDescription>
        </Alert>
        <TestCoverageBreadth risks={testRisks} onSelect={onSelect} />
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
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
      {testRisks.length ? <TestCoverageSilos risks={testRisks} onSelect={onSelect} /> : null}
    </View>
  );
}

/**
 * Solo-repo view: coverage breadth. Test authorship is degenerate here, so rank
 * by fewest linked test files (thinner coverage first) — a real signal.
 */
function TestCoverageBreadth({ risks, onSelect }: { risks: TestCoverageRisk[]; onSelect: (id: string) => void }) {
  const byBreadth = [...risks].sort((a, b) => a.linkedTests - b.linkedTests);
  const maxTests = byBreadth.reduce((m, r) => Math.max(m, r.linkedTests), 1);
  return (
    <Panel title="Test-coverage breadth" subtitle="linked test files per source — fewer = thinner coverage">
      {byBreadth.length === 0 ? (
        <Text style={{ color: cw.textFaint }}>No linked test churn in the window — nothing to rank.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {byBreadth.map((r) => (
            <Pressable key={r.nodeId} onPress={() => onSelect(r.nodeId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(r.nodeId)}</Text>
              </View>
              <Bar frac={r.linkedTests / maxTests} color={r.linkedTests <= 1 ? cw.warning : cw.info} />
              <Text style={{ color: cw.textDim, fontSize: 12, width: 78, textAlign: "right" }}>
                {r.linkedTests} test{r.linkedTests === 1 ? "" : "s"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Panel>
  );
}

/**
 * Multi-author view: a source whose tests are owned by few authors is a test
 * knowledge-silo even if the source itself is well-spread. Bus factor / top
 * author share are meaningful here.
 */
function TestCoverageSilos({ risks, onSelect }: { risks: TestCoverageRisk[]; onSelect: (id: string) => void }) {
  const byConcentration = [...risks].sort((a, b) => b.testTopAuthorShare - a.testTopAuthorShare);
  return (
    <Panel title="Test-coverage silos" subtitle="sources whose test files are owner-concentrated">
      <View style={{ gap: 8 }}>
        {byConcentration.map((r) => (
          <Pressable key={r.nodeId} onPress={() => onSelect(r.nodeId)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: cw.text, fontSize: 13 }} numberOfLines={1}>{shortId(r.nodeId)}</Text>
            </View>
            <Bar frac={r.testTopAuthorShare} color={r.testBusFactor <= 1 ? cw.error : cw.warning} />
            <Text style={{ color: cw.textDim, fontSize: 12, width: 42, textAlign: "right" }}>{pct(r.testTopAuthorShare)}</Text>
            <Text style={{ color: cw.textFaint, fontSize: 12, width: 54, textAlign: "right" }}>{r.linkedTests} test{r.linkedTests === 1 ? "" : "s"}</Text>
          </Pressable>
        ))}
      </View>
    </Panel>
  );
}
