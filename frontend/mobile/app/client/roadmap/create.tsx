import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, Tappable, useToast } from "../../../src/components/ui";
import { fitnessRoadmapService, type RoadmapPhaseType } from "../../../src/services/api";
import { darkColors } from "../../../src/theme/colors";
import {
  buildManualRoadmap,
  GOAL_OPTIONS,
  manualRoadmapError,
  PHASE_TYPE_LABEL,
  roadmapErrorMessage,
  type GoalKey,
  type ManualPhase,
} from "../../../src/features/roadmap/roadmap";
import { ROADMAP_KEY } from "../../../src/features/roadmap/RoadmapJourney";
import { Chip, FieldLabel, Stepper } from "../../../src/features/plans/PlanWidgets";

const PHASE_TYPES = Object.keys(PHASE_TYPE_LABEL) as RoadmapPhaseType[];

/**
 * WB-11 — "Tạo lộ trình nâng cao" (web's ManualCreatePanel): the client picks each phase directly,
 * no AI involved, and the roadmap is saved as a DRAFT to review and start from the journey.
 * Web offers one phase; the same `POST /fitness-roadmaps` takes several, so mobile lets the client
 * chain up to four back-to-back (see buildManualRoadmap for the dates and cycle objective).
 */
export default function RoadmapCreateScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("Lộ trình của tôi");
  const [goalType, setGoalType] = useState<GoalKey>("WEIGHT_LOSS");
  const [phases, setPhases] = useState<ManualPhase[]>([{ phaseType: "FAT_LOSS", weeks: 8 }]);
  const error = manualRoadmapError(phases);

  const create = useMutation({
    mutationFn: () => fitnessRoadmapService.create(buildManualRoadmap({ name, goalType, phases })),
    onSuccess: () => {
      toast.show("Đã lưu bản nháp lộ trình", "success");
      void queryClient.invalidateQueries({ queryKey: ROADMAP_KEY });
      router.replace("/client/roadmap");
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể tạo lộ trình"), "danger"),
  });

  const update = (i: number, patch: Partial<ManualPhase>) => setPhases((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Tạo lộ trình nâng cao" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Input label="Tên lộ trình" value={name} onChangeText={setName} />
        <View>
          <FieldLabel>Mục tiêu</FieldLabel>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_OPTIONS.map((g) => (
              <Chip key={g.key} label={g.label} active={goalType === g.key} onPress={() => setGoalType(g.key)} />
            ))}
          </View>
        </View>

        {phases.map((p, i) => (
          <Card key={i} className="gap-3 p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-display text-base text-foreground">{`Giai đoạn ${i + 1}`}</Text>
              {phases.length > 1 ? (
                <Tappable accessibilityLabel={`Xoá giai đoạn ${i + 1}`} onPress={() => setPhases((prev) => prev.filter((_, j) => j !== i))}>
                  <Trash2 size={16} color={darkColors.mutedForeground} />
                </Tappable>
              ) : null}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {PHASE_TYPES.map((t) => (
                <Chip key={t} label={PHASE_TYPE_LABEL[t]} active={p.phaseType === t} onPress={() => update(i, { phaseType: t })} />
              ))}
            </View>
            <View>
              <FieldLabel>Thời gian giai đoạn</FieldLabel>
              <Stepper value={p.weeks} min={1} max={26} suffix="tuần" onChange={(n) => update(i, { weeks: n })} />
            </View>
          </Card>
        ))}

        {phases.length < 4 ? (
          <Button variant="secondary" icon={Plus} onPress={() => setPhases((prev) => [...prev, { phaseType: "MAINTENANCE", weeks: 4 }])}>
            Thêm giai đoạn
          </Button>
        ) : null}
        <Text className="font-body text-xs text-muted-foreground">
          Các giai đoạn nối tiếp nhau từ hôm nay. Lộ trình được lưu dạng bản nháp — bạn xem lại rồi bấm «Bắt đầu lộ trình».
        </Text>
      </ScrollView>
      <View className="border-t border-border bg-glass px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        {error ? <Text className="mb-2 font-body text-xs text-destructive">{error}</Text> : null}
        <Button full size="lg" disabled={!!error || create.isPending} onPress={() => create.mutate()}>
          {create.isPending ? "Đang tạo…" : "Tạo bản nháp"}
        </Button>
      </View>
    </View>
  );
}
