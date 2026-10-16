import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Plus, Scale } from "lucide-react-native";

import { Button, Card, Segmented } from "../../components/ui";
import { inbodyService, profileService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import {
  computeActivityTypeDistribution,
  computeMuscleGroupDistribution,
  weightJourney,
  type AnalyticsTimeFilter,
  type DistributionSlice,
} from "./workoutAnalytics";

/**
 * 14B.4 (PG-C2) — web's "Chỉ số cơ thể" (weight journey) and the two distribution charts, under the
 * Nhật ký tab. The body-metric line charts and manual entry already live on the InBody screen, so the
 * block links there instead of duplicating them. Query keys are the ones the dashboard and InBody
 * screens already use.
 */

const FILTERS: { label: string; value: AnalyticsTimeFilter }[] = [
  { label: "Gần nhất", value: "last" },
  { label: "7 ngày", value: "week" },
  { label: "30 ngày", value: "month" },
  { label: "Tất cả", value: "all" },
];
const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#a78bfa", "#ef4444", "#14b8a6"];

export function BodyJourneyCard() {
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });
  const inbodyQuery = useQuery({ queryKey: ["inbody-history"], queryFn: inbodyService.getHistory });
  const latest = Array.isArray(inbodyQuery.data) ? inbodyQuery.data[0] : null;
  const journey = weightJourney(profileQuery.data, latest?.weight);

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Scale size={16} color={accent.primary} />
          <Text className="font-body-semibold text-sm text-foreground">Chỉ số cơ thể</Text>
        </View>
        <Button size="sm" variant="ghost" icon={Plus} onPress={() => router.push("/client/inbody/entry")}>
          Ghi chỉ số
        </Button>
      </View>
      {journey ? (
        <View className="flex-row flex-wrap justify-between gap-y-2">
          {[
            ["Bắt đầu", `${journey.start} kg`],
            ["Hiện tại", `${journey.current} kg`],
            ["Đã thay đổi", journey.changedText],
            ["Còn lại", journey.remainingText],
          ].map(([label, value]) => (
            <View key={label} className="w-[48.5%] rounded-xl border border-border bg-panel p-3">
              <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
              <Text className="mt-0.5 font-display text-base text-foreground">{value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="font-body text-xs text-muted-foreground">Cần cân nặng ban đầu và một lần đo để xem hành trình cân nặng.</Text>
      )}
      {latest ? (
        <Text className="font-body text-[11px] text-muted-foreground">
          {[
            latest.weight != null ? `Cân nặng ${latest.weight} kg` : null,
            latest.bodyFatPct != null ? `Mỡ ${latest.bodyFatPct}%` : null,
            latest.muscleMass != null ? `Cơ ${latest.muscleMass} kg` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      <Button size="sm" variant="secondary" onPress={() => router.push("/client/inbody")}>
        Xem xu hướng chỉ số
      </Button>
    </Card>
  );
}

function Distribution({ title, slices }: { title: string; slices: DistributionSlice[] }) {
  return (
    <View className="gap-2">
      <Text className="font-body-semibold text-xs text-muted-foreground">{title}</Text>
      {slices.length === 0 ? (
        <Text className="font-body text-xs text-muted-foreground">Chưa có dữ liệu buổi tập nào trong khoảng thời gian này.</Text>
      ) : (
        <>
          {/* One stacked bar instead of web's pie (same numbers, readable on a phone). */}
          <View className="h-3 w-full flex-row overflow-hidden rounded-full bg-panel">
            {slices.map((s, i) => (
              <View key={s.name} style={{ width: `${s.value}%`, backgroundColor: COLORS[i % COLORS.length] }} />
            ))}
          </View>
          <View className="flex-row flex-wrap gap-x-3 gap-y-1">
            {slices.map((s, i) => (
              <View key={s.name} className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <Text className="font-body text-[11px] text-foreground">
                  {s.name} {s.value}%
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export function TrainingDistributionCard({ workouts }: { workouts: any[] }) {
  const accent = useWorkspaceAccent();
  const [filter, setFilter] = useState<AnalyticsTimeFilter>("week");
  const muscles = useMemo(() => computeMuscleGroupDistribution(workouts, filter), [workouts, filter]);
  const types = useMemo(() => computeActivityTypeDistribution(workouts, filter), [workouts, filter]);
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <PieChart size={16} color={accent.primary} />
        <Text className="font-body-semibold text-sm text-foreground">Phân bổ tập luyện</Text>
      </View>
      <Segmented
        options={FILTERS.map((f) => f.label)}
        value={FILTERS.find((f) => f.value === filter)?.label ?? "7 ngày"}
        onChange={(v) => setFilter(FILTERS.find((f) => f.label === v)?.value ?? "week")}
      />
      <Distribution title="Phân bổ nhóm cơ" slices={muscles} />
      <Distribution title="Phân bổ loại bài tập" slices={types} />
    </Card>
  );
}
