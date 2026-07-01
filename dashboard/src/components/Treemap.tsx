import React from "react";
import { View, Text, Pressable } from "react-native";

/**
 * Squarified treemap. SVG-free (absolutely-positioned Views) so it renders
 * identically under react-native-web and native. Candidate for upstreaming
 * into @titan-design/react-ui — Titan has chart color tokens but no treemap.
 */

export interface TreemapDatum {
  id: string;
  /** Area weight (e.g. LOC or churn). Non-positive values are dropped. */
  value: number;
  /** Fill color (caller maps a metric → color). */
  color: string;
  label?: string;
}

export interface TreemapProps {
  data: TreemapDatum[];
  width: number;
  height: number;
  /** Show at most N tiles; the rest fold into one "+M more" tile. */
  maxTiles?: number;
  onSelect?: (id: string) => void;
  selectedId?: string;
  /**
   * Area scale. Code metrics (churn×complexity, LOC) are heavy-tailed — one
   * outlier under a linear scale annihilates every other tile. `sqrt` (default)
   * damps that while preserving order; `linear` is faithful when the spread is
   * modest.
   */
  scale?: "linear" | "sqrt" | "log";
}

function scaleValue(v: number, scale: "linear" | "sqrt" | "log"): number {
  if (v <= 0) return 0;
  if (scale === "sqrt") return Math.sqrt(v);
  if (scale === "log") return Math.log10(v + 1);
  return v;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  datum: TreemapDatum;
}

function squarify(
  data: TreemapDatum[],
  x: number,
  y: number,
  w: number,
  h: number,
): Rect[] {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return [];
  const scaled = data.map((d) => ({ datum: d, area: (d.value / total) * w * h }));
  const out: Rect[] = [];
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;
  let i = 0;

  while (i < scaled.length) {
    const vertical = rw >= rh;
    const side = vertical ? rh : rw;
    let row: typeof scaled = [];
    let bestWorst = Infinity;
    let j = i;
    // Grow the row while the worst aspect ratio keeps improving.
    while (j < scaled.length) {
      const trial = [...row, scaled[j]];
      const worst = worstRatio(trial, side);
      if (row.length > 0 && worst > bestWorst) break;
      row = trial;
      bestWorst = worst;
      j++;
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    const thickness = rowArea / side;
    let along = vertical ? ry : rx;
    for (const r of row) {
      const len = r.area / thickness;
      out.push(
        vertical
          ? { x: rx, y: along, w: thickness, h: len, datum: r.datum }
          : { x: along, y: ry, w: len, h: thickness, datum: r.datum },
      );
      along += len;
    }
    if (vertical) {
      rx += thickness;
      rw -= thickness;
    } else {
      ry += thickness;
      rh -= thickness;
    }
    i = j;
  }
  return out;
}

function worstRatio(row: { area: number }[], side: number): number {
  const sum = row.reduce((s, r) => s + r.area, 0);
  const thickness = sum / side;
  let worst = 0;
  for (const r of row) {
    const len = r.area / thickness;
    const ratio = Math.max(thickness / len, len / thickness);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

export function Treemap({
  data,
  width,
  height,
  maxTiles = 60,
  onSelect,
  selectedId,
  scale = "sqrt",
}: TreemapProps) {
  const clean = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  let tiles = clean;
  if (clean.length > maxTiles) {
    const head = clean.slice(0, maxTiles - 1);
    const restValue = clean.slice(maxTiles - 1).reduce((s, d) => s + d.value, 0);
    tiles = [
      ...head,
      { id: "__more__", value: restValue, color: "#3a3a3a", label: `+${clean.length - (maxTiles - 1)} more` },
    ];
  }
  // Lay out on scaled weights so a single outlier can't swallow the canvas.
  const weighted = tiles.map((d) => ({ ...d, value: scaleValue(d.value, scale) }));
  const rects = squarify(weighted, 0, 0, width, height);

  return (
    <View style={{ width, height, position: "relative" }}>
      {rects.map((r) => {
        const selected = r.datum.id === selectedId;
        const big = r.w > 54 && r.h > 22;
        return (
          <Pressable
            key={r.datum.id}
            onPress={() => r.datum.id !== "__more__" && onSelect?.(r.datum.id)}
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: Math.max(0, r.w - 2),
              height: Math.max(0, r.h - 2),
              backgroundColor: r.datum.color,
              borderRadius: 3,
              opacity: selected ? 1 : 0.9,
              borderWidth: selected ? 2 : 0,
              borderColor: "#ffffff",
              padding: 4,
              overflow: "hidden",
            }}
          >
            {big && (
              <Text
                numberOfLines={2}
                style={{ fontSize: 10, color: "#0b0b0b", fontWeight: "600" }}
              >
                {r.datum.label ?? r.datum.id}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
