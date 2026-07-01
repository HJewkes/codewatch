import React from "react";
import type { Drift } from "../types";
import { Pillet } from "./primitives";
import { cw, SCARY_SCORE } from "../theme";

/**
 * Per-file drift classification, shared by the Hotspots and Overview lists so a
 * hotspot row can say *why it's here now* — a brand-new file, an existing file
 * that just climbed into the ranking, or one whose score worsened — instead of
 * reading as an undifferentiated "files I touched this month".
 */
export type DriftMark =
  | { kind: "new-file" }
  | { kind: "risen"; scary: boolean }
  | { kind: "worsened"; delta: number; scary: boolean };

/** Index drift → nodeId, so O(1) lookup per rendered row. Empty when no baseline. */
export function buildDriftIndex(drift?: Drift): Map<string, DriftMark> {
  const m = new Map<string, DriftMark>();
  if (!drift) return m;
  for (const h of drift.newHotspots) {
    m.set(
      h.nodeId,
      h.before === undefined
        ? { kind: "new-file" }
        : { kind: "risen", scary: h.score >= SCARY_SCORE },
    );
  }
  for (const d of drift.worsened) {
    m.set(d.nodeId, { kind: "worsened", delta: d.delta, scary: d.after >= SCARY_SCORE });
  }
  return m;
}

export function DriftBadge({ mark }: { mark?: DriftMark }) {
  if (!mark) return null;
  if (mark.kind === "new-file") return <Pillet text="new" color={cw.info} />;
  if (mark.kind === "risen") return <Pillet text="entered" color={mark.scary ? cw.error : cw.warning} />;
  return <Pillet text={`▲+${mark.delta}`} color={mark.scary ? cw.error : cw.warning} />;
}
