import { useState } from "react";
import { Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Card, Text, Button, colors, radius, spacing } from "../../ui";
import { useProfileQuery, queryKeys } from "../../api/queries";
import { profileApi, type Goal } from "../../api/profile";
import { getApiErrorMessage } from "../../api/client";

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: "WEIGHT_LOSS", label: "Giảm mỡ" },
  { value: "MUSCLE_GAIN", label: "Tăng cơ" },
  { value: "MAINTENANCE", label: "Duy trì" },
  { value: "ATHLETIC_PERFORMANCE", label: "Hiệu suất" },
];

export function GoalEditor() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useProfileQuery();
  const [selected, setSelected] = useState<Goal | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentGoal = selected ?? profile?.goal ?? null;
  const dirty = selected !== null && selected !== profile?.goal;

  const onSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await profileApi.updateProfile({ goal: selected });
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelected(null);
    } catch (err) {
      setError(getApiErrorMessage(err, "Không thể cập nhật mục tiêu"));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return null;

  return (
    <Card>
      <Text variant="bodyStrong">Mục tiêu</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
        {GOAL_OPTIONS.map((opt) => {
          const active = currentGoal === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setSelected(opt.value)}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.accent : "transparent",
              }}
            >
              <Text variant="caption" color={active ? colors.onAccent : colors.textSecondary}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}
      {dirty ? (
        <Button label="Lưu mục tiêu" onPress={onSave} loading={saving} style={{ marginTop: spacing.md }} />
      ) : null}
    </Card>
  );
}
