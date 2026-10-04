import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Repeat, Trophy } from "lucide-react-native";

import { BottomSheet, Card, Tappable } from "../../components/ui";
import { exerciseService, workoutService, type ExerciseSubstitute } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { SET_TYPE_OPTIONS } from "./exerciseActions";

/**
 * 14B.4 (PG-A3) — web's SwapExerciseModal, the set-type picker and the completed session's summary
 * (`GET /workouts/:id/summary`: exercises, sets, volume, PRs — all server numbers).
 */

export function SwapExerciseSheet({
  exercise,
  otherExerciseIds,
  onSelect,
  onClose,
}: {
  exercise: { exerciseId: string; name: string } | null;
  otherExerciseIds: string[];
  onSelect: (sub: ExerciseSubstitute) => void;
  onClose: () => void;
}) {
  const accent = useWorkspaceAccent();
  const query = useQuery({
    queryKey: ["exercise-substitutes", exercise?.exerciseId, otherExerciseIds],
    queryFn: () => exerciseService.getSubstitutes(String(exercise?.exerciseId), { excludeExerciseIds: otherExerciseIds, limit: 6 }),
    enabled: !!exercise?.exerciseId,
  });
  return (
    <BottomSheet open={exercise != null} onClose={onClose} title="Đổi bài tập">
      {exercise ? (
        <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
          <Text className="font-body text-xs text-muted-foreground">
            {`Không thể tập “${exercise.name}”?`} Chọn bài thay thế phù hợp với thiết bị và nhóm cơ. Chỉ đổi cho buổi hôm nay — giáo án
            các tuần sau giữ nguyên.
          </Text>
          {query.isLoading ? (
            <ActivityIndicator className="py-6" color={accent.primary} />
          ) : query.isError ? (
            <Text className="font-body text-sm text-destructive">Không tải được bài thay thế.</Text>
          ) : (query.data ?? []).length === 0 ? (
            <Text className="font-body text-sm text-muted-foreground">
              Không tìm thấy bài thay thế phù hợp với thiết bị bạn đã lưu. Hãy cập nhật thiết bị trong Hồ sơ → Thiết bị tập luyện.
            </Text>
          ) : (
            (query.data ?? []).map((sub) => (
              <Tappable key={sub.id} onPress={() => onSelect(sub)} className="flex-row items-center gap-3 rounded-xl border border-border bg-panel p-3">
                <Repeat size={16} color={accent.primary} />
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">{sub.exerciseName}</Text>
                  <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={2}>
                    {[sub.reason, sub.muscleGroupsActivated.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </Tappable>
            ))
          )}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

export function SetTypeSheet({ current, open, onSelect, onClose }: { current: string | null | undefined; open: boolean; onSelect: (v: string) => void; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Loại set">
      <View className="gap-2 pb-2">
        {SET_TYPE_OPTIONS.map((o) => {
          const on = (current || "WORKING") === o.value;
          return (
            <Tappable
              key={o.value}
              onPress={() => onSelect(o.value)}
              className={`rounded-xl border px-4 py-3 ${on ? "border-primary bg-primary/10" : "border-border bg-panel"}`}
            >
              <Text className={`font-body-semibold text-sm ${on ? "text-primary" : "text-foreground"}`}>{o.label}</Text>
            </Tappable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

export function SessionSummaryCard({ workoutId }: { workoutId: string }) {
  const accent = useWorkspaceAccent();
  const query = useQuery({
    queryKey: ["workout-summary", workoutId],
    queryFn: () => workoutService.getSessionSummary(workoutId),
  });
  const s = query.data;
  if (!s) return null;
  return (
    <Card className="mb-4 gap-3 p-4">
      <Text className="font-body-semibold text-sm text-foreground">Tóm tắt buổi tập</Text>
      <View className="flex-row">
        {[
          [String(s.exerciseCount), "Bài tập"],
          [String(s.totalSets), "Set"],
          [`${Math.round(s.totalVolumeKg).toLocaleString("vi-VN")} kg`, "Khối lượng"],
        ].map(([v, l]) => (
          <View key={l} className="flex-1 items-center">
            <Text className="font-display text-lg text-foreground">{v}</Text>
            <Text className="font-body text-[11px] text-muted-foreground">{l}</Text>
          </View>
        ))}
      </View>
      {s.prs.length > 0 ? (
        <View className="gap-1.5 border-t border-border pt-3">
          {s.prs.map((pr) => (
            <View key={pr.exerciseId} className="flex-row items-center gap-2">
              <Trophy size={14} color={accent.primary} />
              <Text className="flex-1 font-body text-xs text-foreground">
                PR mới · {pr.exerciseName}
                {pr.prType === "REPS"
                  ? ` — ${pr.reps} reps${pr.previousBestReps != null ? ` (trước: ${pr.previousBestReps})` : ""}`
                  : ` — ${pr.weightKg ?? "—"} kg × ${pr.reps ?? "—"}${pr.estimated1RmKg != null ? ` (e1RM ${Math.round(pr.estimated1RmKg)} kg)` : ""}`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
