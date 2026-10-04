import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react-native";

import { ScreenHeader } from "../../../../src/components/ui";
import { workoutService } from "../../../../src/services/api";
import { PlanDraftBuilder } from "../../../../src/features/pt/PlanDraftBuilder";

/**
 * 14B.4 (PG-A3) — web's manual program builder ("Tạo chương trình thủ công"). Same body as web:
 * repeat for the whole duration and replace the unfinished schedule (`replaceExisting: true`); the
 * server creates the program and its schedule rows, linking them to the active training cycle.
 */
export default function NewProgramScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/client/workout"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Chương trình mới" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text className="rounded-xl border border-warning/30 bg-warning/10 p-3 font-body text-xs leading-5 text-foreground">
          Chương trình mới sẽ thay các buổi chưa tập trong lịch hiện tại. Buổi đã tập giữ nguyên.
        </Text>
        <PlanDraftBuilder
          clientUserId=""
          hideAiDraft
          includeCustomExercises
          title="Tự soạn chương trình"
          nameLabel="Tên chương trình *"
          initialName="Chương trình của tôi"
          showGoal
          defaultWeeks={4}
          submitLabel="Tạo chương trình"
          submittingLabel="Đang tạo…"
          submitIcon={ClipboardList}
          successMessage="Đã tạo chương trình thủ công"
          errorFallback="Không thể tạo chương trình thủ công"
          onSubmit={(payload) =>
            workoutService.createManualProgram({ ...payload, repeatWeeks: payload.durationWeeks, replaceExisting: true })
          }
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
            // Reset, not invalidate: the programs screen would otherwise show the replaced program
            // from cache until the refetch lands.
            void queryClient.resetQueries({ queryKey: ["workout-current-program"] });
            void queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
            // Back to the programs screen already under this one (opened from it), or onto it when
            // this screen came from the day sheet — never a second programs screen on the stack.
            router.dismissTo("/client/workout/programs");
          }}
        />
      </ScrollView>
    </View>
  );
}
