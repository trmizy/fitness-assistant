import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card, Button, EmptyState, SkeletonCard, colors, radius, spacing } from "../../../../src/ui";
import { useInBodyHistoryQuery, useActiveCycleQuery } from "../../../../src/api/queries";
import { TrendChart, type TrendMetric } from "../../../../src/features/inbody/TrendChart";
import { formatShortDate } from "../../../../src/lib/date";
import { env } from "../../../../src/config/env";

const METRICS: { key: TrendMetric; label: string }[] = [
  { key: "weight", label: "Cân nặng" },
  { key: "muscleMass", label: "SMM" },
  { key: "bodyFatPct", label: "% Mỡ" },
];

export default function InBodyHubScreen() {
  const router = useRouter();
  const { data: history, isLoading } = useInBodyHistoryQuery();
  const { data: activeCycleData } = useActiveCycleQuery();
  const [metric, setMetric] = useState<TrendMetric>("weight");

  const sorted = [...(history ?? [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return (
    <Screen scroll>
      {isLoading ? (
        <SkeletonCard lines={4} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={(p) => <Feather name="bar-chart-2" {...p} />}
          title="Chưa có bản ghi InBody"
          description="Thêm bản ghi đầu tiên để bắt đầu theo dõi."
          actionLabel="Thêm bản ghi"
          onAction={() => router.push("/(app)/(tabs)/inbody/add")}
        />
      ) : (
        <Card>
          <View style={{ flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md }}>
            {METRICS.map((m) => {
              const active = metric === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMetric(m.key)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accent : "transparent",
                  }}
                >
                  <Text variant="small" color={active ? colors.onAccent : colors.textSecondary}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TrendChart
            entries={sorted}
            metric={metric}
            cycleRange={
              env.featureCycles && activeCycleData?.cycle
                ? { startDate: activeCycleData.cycle.startDate, endDate: activeCycleData.cycle.endDate }
                : null
            }
          />
        </Card>
      )}

      <Button label="+ Thêm bản ghi" onPress={() => router.push("/(app)/(tabs)/inbody/add")} fullWidth />

      {sorted.length > 0 ? (
        <View>
          <Text variant="small" style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
            LỊCH SỬ
          </Text>
          {[...sorted].reverse().map((entry) => (
            <Card key={entry.id} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text variant="bodyStrong">{entry.weight} kg</Text>
                <Text variant="caption">{formatShortDate(entry.date)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: 4 }}>
                {entry.bodyFatPct != null ? (
                  <Text variant="caption">Mỡ: {entry.bodyFatPct}%</Text>
                ) : null}
                <Text variant="caption">SMM: {entry.muscleMass}kg</Text>
                {entry.visceralFat != null ? (
                  <Text variant="caption">VFA: {entry.visceralFat}</Text>
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
