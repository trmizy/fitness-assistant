import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect } from "react-native-svg";
import { Text, colors, spacing } from "../../ui";
import type { InBodyEntry } from "../../api/inbody";

export type TrendMetric = "weight" | "muscleMass" | "bodyFatPct";

const METRIC_LABEL: Record<TrendMetric, string> = {
  weight: "Cân nặng (kg)",
  muscleMass: "SMM (kg)",
  bodyFatPct: "% Mỡ cơ thể",
};

interface TrendChartProps {
  entries: InBodyEntry[];
  metric: TrendMetric;
  cycleRange?: { startDate: string; endDate: string } | null;
  height?: number;
}

const CHART_PADDING = 16;

// Simple hand-rolled SVG line chart — no charting library needed for a
// single metric over a handful of points. X spacing is index-based (not
// strictly time-proportional) which is an acceptable simplification for
// InBody's typical cadence (weekly/monthly entries).
export function TrendChart({ entries, metric, cycleRange, height = 160 }: TrendChartProps) {
  const points = useMemo(
    () =>
      entries
        .map((e) => ({ date: e.date, value: e[metric] }))
        .filter((p): p is { date: string; value: number } => typeof p.value === "number"),
    [entries, metric],
  );

  if (points.length < 2) {
    return (
      <View style={{ height, alignItems: "center", justifyContent: "center" }}>
        <Text variant="caption">Cần ít nhất 2 bản ghi để vẽ biểu đồ</Text>
      </View>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const yPad = range * 0.15;

  const width = 320; // viewBox width; SVG scales to container via width="100%"
  const innerWidth = width - CHART_PADDING * 2;
  const innerHeight = height - CHART_PADDING * 2;

  const toX = (i: number) => CHART_PADDING + (i / (points.length - 1)) * innerWidth;
  const toY = (v: number) =>
    CHART_PADDING + innerHeight - ((v - (min - yPad)) / (range + yPad * 2)) * innerHeight;

  const polylinePoints = points.map((p, i) => `${toX(i)},${toY(p.value)}`).join(" ");

  let cycleBand: { x1: number; x2: number } | null = null;
  if (cycleRange) {
    const startTime = new Date(cycleRange.startDate).getTime();
    const endTime = new Date(cycleRange.endDate).getTime();
    const idxInRange = points
      .map((p, i) => ({ i, t: new Date(p.date).getTime() }))
      .filter((p) => p.t >= startTime && p.t <= endTime)
      .map((p) => p.i);
    if (idxInRange.length > 0) {
      cycleBand = { x1: toX(idxInRange[0]), x2: toX(idxInRange[idxInRange.length - 1]) };
    }
  }

  return (
    <View>
      <Text variant="small" style={{ color: colors.textMuted, marginBottom: spacing.xs }}>
        {METRIC_LABEL[metric]}
      </Text>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {cycleBand ? (
          <Rect
            x={cycleBand.x1 - 4}
            y={0}
            width={Math.max(cycleBand.x2 - cycleBand.x1 + 8, 4)}
            height={height}
            fill={colors.accentSoft}
          />
        ) : null}
        <Line
          x1={CHART_PADDING}
          y1={height - CHART_PADDING}
          x2={width - CHART_PADDING}
          y2={height - CHART_PADDING}
          stroke={colors.border}
          strokeWidth={1}
        />
        <Polyline points={polylinePoints} fill="none" stroke={colors.accent} strokeWidth={2.5} />
        {points.map((p, i) => (
          <Circle key={p.date} cx={toX(i)} cy={toY(p.value)} r={3.5} fill={colors.accent} />
        ))}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs }}>
        <Text variant="small">{new Date(points[0].date).toLocaleDateString("vi-VN")}</Text>
        <Text variant="small">{new Date(points[points.length - 1].date).toLocaleDateString("vi-VN")}</Text>
      </View>
    </View>
  );
}
