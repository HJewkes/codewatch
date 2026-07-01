import React from "react";
import { View, Text } from "react-native";
import {
  Card,
  CardContent,
  Metric,
  Typography,
  Badge,
  BadgeText,
} from "@titan-design/react-ui";
import { cw } from "../theme";

/** A titled surface panel. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  flex,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  flex?: number;
}) {
  return (
    <View
      style={{
        flex,
        backgroundColor: cw.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: cw.border,
        padding: 16,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Text style={{ color: cw.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
          {subtitle ? (
            <Text style={{ color: cw.textFaint, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** KPI tile — Titan Card + Metric with a delta trend. */
export function KpiTile({
  label,
  value,
  unit,
  trend,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  trend?: { direction: "up" | "down" | "flat"; value: string; good?: boolean };
  accent?: string;
}) {
  const titanTrend = trend
    ? { direction: trend.direction, value: trend.value }
    : undefined;
  return (
    <Card style={{ flex: 1, minWidth: 150 }}>
      <CardContent>
        <View style={{ gap: 6 }}>
          {accent ? (
            <View style={{ height: 3, width: 28, borderRadius: 2, backgroundColor: accent }} />
          ) : null}
          <Metric value={value} label={label} unit={unit} trend={titanTrend as any} />
        </View>
      </CardContent>
    </Card>
  );
}

export function SeverityBadge({ status }: { status: "error" | "warning" }) {
  return (
    <Badge color={status === "error" ? "error" : "warning"} variant="subtle">
      <BadgeText>{status}</BadgeText>
    </Badge>
  );
}

export function Pillet({ text, color }: { text: string; color: string }) {
  // color-mix accepts CSS-var inputs (our tokens are `var(--…, #hex)`), unlike
  // hex-alpha string concat which produces invalid values the browser drops.
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        borderWidth: 1,
        borderColor: `color-mix(in srgb, ${color} 34%, transparent)`,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

/** Horizontal magnitude bar (0..1), colored by caller. */
export function Bar({ frac, color, width = 90 }: { frac: number; color: string; width?: number }) {
  return (
    <View style={{ width, height: 7, borderRadius: 4, backgroundColor: cw.raised, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(2, Math.min(100, frac * 100))}%`, height: "100%", backgroundColor: color }} />
    </View>
  );
}

export { Typography };
