import { useState } from "react";
import { Modal, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Text, Button, colors, radius, spacing } from "../../ui";
import { trainingCyclesApi, type TrainingCycle } from "../../api/trainingCycles";
import { getApiErrorMessage } from "../../api/client";
import { queryKeys } from "../../api/queries";

interface CloseCycleSheetProps {
  visible: boolean;
  cycle: TrainingCycle | null;
  entryId: string | null;
  onDismiss: () => void;
}

// Bottom-sheet đơn giản dựng bằng Modal có sẵn của RN — không cần thêm
// thư viện bottom-sheet riêng cho 1 use case duy nhất này.
export function CloseCycleSheet({ visible, cycle, entryId, onDismiss }: CloseCycleSheetProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!cycle || !entryId) return null;

  const onConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await trainingCyclesApi.complete(cycle.id, entryId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.activeCycle });
      onDismiss();
      router.push("/(app)/(tabs)/plans");
    } catch (err) {
      setError(getApiErrorMessage(err, "Không thể đóng chu kỳ"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onDismiss}>
        <Pressable
          style={{
            marginTop: "auto",
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.xl,
            gap: spacing.sm,
          }}
        >
          <Text variant="subheading">Bản ghi này gần ngày kết thúc chu kỳ</Text>
          <Text variant="caption">
            Chu kỳ #{cycle.cycleIndex} sắp kết thúc. Dùng bản ghi InBody vừa thêm để đóng chu kỳ và
            nhận đề xuất bước tiếp theo?
          </Text>
          {error ? (
            <Text variant="caption" color={colors.danger}>
              {error}
            </Text>
          ) : null}
          <Button label="Đóng chu kỳ với bản ghi này" onPress={onConfirm} loading={submitting} fullWidth />
          <Button label="Để sau" variant="ghost" onPress={onDismiss} fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
