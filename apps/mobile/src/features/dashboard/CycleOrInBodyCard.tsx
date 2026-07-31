import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Text, Badge, Button, SkeletonCard, ErrorNotice, colors, spacing } from "../../ui";
import { useActiveCycleQuery, useLatestInBodyQuery, queryKeys } from "../../api/queries";
import { trainingCyclesApi } from "../../api/trainingCycles";
import { elapsedPercent, formatShortDate } from "../../lib/date";
import { env } from "../../config/env";
import { getApiErrorMessage } from "../../api/client";

function TrendLine({ label, delta, unit }: { label: string; delta: number | null | undefined; unit: string }) {
  if (delta === null || delta === undefined) return null;
  const sign = delta > 0 ? "+" : "";
  const tone = delta > 0 ? colors.success : delta < 0 ? colors.danger : colors.textSecondary;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text variant="caption">{label}</Text>
      <Text variant="bodyStrong" color={tone}>
        {sign}
        {delta.toFixed(1)} {unit}
      </Text>
    </View>
  );
}

function ActiveCycleCard() {
  const { data, isLoading, isError, refetch } = useActiveCycleQuery();
  const router = useRouter();

  if (isLoading) return <SkeletonCard lines={3} />;
  if (isError) return <ErrorNotice onRetry={refetch} />;
  if (!data) return null;

  const { cycle, summary } = data;
  const percent = elapsedPercent(cycle.startDate, cycle.endDate);
  const first = summary.inBodySeries[0];
  const last = summary.inBodySeries[summary.inBodySeries.length - 1];
  const deltaWeight = first && last ? last.weight - first.weight : null;
  const deltaSMM = first && last ? last.muscleMass - first.muscleMass : null;
  const warningAlerts = summary.alerts.filter((a) => a.severity === "warning");

  return (
    <Card onPress={() => router.push("/(app)/(tabs)/plans")}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="subheading">Chu kỳ hiện tại · #{cycle.cycleIndex}</Text>
        {warningAlerts.length > 0 ? (
          <Badge label={`${warningAlerts.length} cảnh báo`} tone="warning" />
        ) : (
          <Badge label="Đang tốt" tone="success" />
        )}
      </View>

      <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="caption">Thời gian</Text>
          <Text variant="bodyStrong">{percent}%</Text>
        </View>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.surfaceAlt,
            overflow: "hidden",
          }}
        >
          <View style={{ width: `${percent}%`, height: "100%", backgroundColor: colors.accent }} />
        </View>

        <TrendLine label="Cân nặng so đầu kỳ" delta={deltaWeight} unit="kg" />
        <TrendLine label="Cơ (SMM) so đầu kỳ" delta={deltaSMM} unit="kg" />

        <Text variant="small" style={{ marginTop: spacing.xs }}>
          Kết thúc {formatShortDate(cycle.endDate)}
        </Text>
      </View>
    </Card>
  );
}

function LatestInBodyCard() {
  const { data, isLoading, isError, refetch } = useLatestInBodyQuery();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (isLoading) return <SkeletonCard lines={2} />;
  if (isError) return <ErrorNotice onRetry={refetch} />;

  const onStartCycle = async () => {
    setStartError(null);
    setStarting(true);
    try {
      await trainingCyclesApi.start({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.activeCycle });
    } catch (err) {
      setStartError(getApiErrorMessage(err, "Không thể bắt đầu chu kỳ"));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <Text variant="subheading">Chỉ số InBody mới nhất</Text>
      {data ? (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text variant="caption">Cân nặng</Text>
            <Text variant="bodyStrong">{data.weight} kg</Text>
          </View>
          {data.bodyFatPct != null ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text variant="caption">% Mỡ cơ thể</Text>
              <Text variant="bodyStrong">{data.bodyFatPct}%</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text variant="caption">Khối cơ (SMM)</Text>
            <Text variant="bodyStrong">{data.muscleMass} kg</Text>
          </View>
          <Text variant="small">Đo ngày {formatShortDate(data.date)}</Text>
        </View>
      ) : (
        <Text variant="caption" style={{ marginTop: spacing.sm }}>
          Chưa có bản ghi InBody nào.
        </Text>
      )}

      {env.featureCycles ? (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          {startError ? (
            <Text variant="caption" color={colors.danger}>
              {startError}
            </Text>
          ) : null}
          <Button
            label="Bắt đầu chu kỳ mới"
            variant="secondary"
            loading={starting}
            onPress={onStartCycle}
          />
        </View>
      ) : (
        <Button
          label="Thêm InBody"
          variant="secondary"
          style={{ marginTop: spacing.md }}
          onPress={() => router.push("/(app)/(tabs)/inbody")}
        />
      )}
    </Card>
  );
}

// Ưu tiên card chu kỳ nếu có chu kỳ ACTIVE; ngược lại fallback InBody
// mới nhất (kể cả khi feature bật nhưng user chưa bắt đầu chu kỳ nào).
export function CycleOrInBodyCard() {
  const { data: activeCycle, isLoading } = useActiveCycleQuery();

  if (env.featureCycles && (isLoading || activeCycle)) {
    return isLoading ? <SkeletonCard lines={3} /> : <ActiveCycleCard />;
  }
  return <LatestInBodyCard />;
}
