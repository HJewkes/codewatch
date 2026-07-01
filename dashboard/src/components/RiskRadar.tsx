import React from "react";
import { View, Text } from "react-native";
import { cw, tint } from "../theme";

export interface RiskAxis {
  label: string;
  /** 0..1, higher = worse. */
  value: number;
}

/**
 * Compact radar of normalized risk dimensions. SVG-free: the filled polygon is
 * a react-native-web View clipped with CSS clip-path; grid rings + axes are
 * positioned Views. A novel "risk at a glance" status communicator.
 */
export function RiskRadar({ axes, size = 240 }: { axes: RiskAxis[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 34;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number) => ({
    x: cx + Math.cos(angle(i)) * r,
    y: cy + Math.sin(angle(i)) * r,
  });

  const polygon = axes
    .map((a, i) => {
      const p = pt(i, R * Math.max(0.02, Math.min(1, a.value)));
      return `${((p.x / size) * 100).toFixed(1)}% ${((p.y / size) * 100).toFixed(1)}%`;
    })
    .join(", ");

  const rings = [0.33, 0.66, 1];

  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {/* grid rings */}
      {rings.map((f) => (
        <View
          key={f}
          style={{
            position: "absolute",
            left: cx - R * f,
            top: cy - R * f,
            width: R * f * 2,
            height: R * f * 2,
            borderRadius: R * f,
            borderWidth: 1,
            borderColor: tint(cw.textFaint, 0.45),
          }}
        />
      ))}
      {/* filled risk polygon */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          backgroundColor: tint(cw.error, 0.35),
          borderWidth: 0,
          // @ts-expect-error web-only style passthrough
          clipPath: `polygon(${polygon})`,
        }}
      />
      {/* vertex markers so the shape reads even when the fill is subtle */}
      {axes.map((a, i) => {
        const p = pt(i, R * Math.max(0.02, Math.min(1, a.value)));
        return (
          <View
            key={`v${i}`}
            style={{ position: "absolute", left: p.x - 3, top: p.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: cw.error }}
          />
        );
      })}
      {/* axis labels */}
      {axes.map((a, i) => {
        const p = pt(i, R + 16);
        return (
          <Text
            key={a.label}
            style={{
              position: "absolute",
              left: p.x - 40,
              top: p.y - 8,
              width: 80,
              textAlign: "center",
              color: cw.textDim,
              fontSize: 10,
            }}
            numberOfLines={1}
          >
            {a.label}
          </Text>
        );
      })}
    </View>
  );
}
