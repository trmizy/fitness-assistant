import { Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text, colors, radius, spacing } from "../../ui";
import type { DraftSet } from "./workoutDraftStore";

interface StepperProps {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  decimals?: number;
  onChange: (value: number) => void;
}

// Large tap targets (40px) so the whole set-entry flow works one-handed
// with a thumb — no keyboard needed for the common case.
function Stepper({ label, value, step, min, max, decimals = 0, onChange }: StepperProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);

  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <Text variant="small">{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Giảm ${label}`}
          onPress={() => onChange(clamp(value - step))}
          style={({ pressed }) => [stepperBtnStyle, pressed && { opacity: 0.7 }]}
        >
          <Feather name="minus" size={16} color={colors.textPrimary} />
        </Pressable>
        <Text variant="bodyStrong" style={{ minWidth: 36, textAlign: "center" }}>
          {display}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tăng ${label}`}
          onPress={() => onChange(clamp(value + step))}
          style={({ pressed }) => [stepperBtnStyle, pressed && { opacity: 0.7 }]}
        >
          <Feather name="plus" size={16} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const stepperBtnStyle = {
  width: 32,
  height: 32,
  borderRadius: radius.sm,
  backgroundColor: colors.surfaceAlt,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

interface SetRowProps {
  index: number;
  set: DraftSet;
  onChange: (patch: Partial<Omit<DraftSet, "localId">>) => void;
  onRemove: () => void;
}

export function SetRow({ index, set, onChange, onRemove }: SetRowProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: spacing.sm,
        borderTopWidth: index === 0 ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <Text variant="caption" style={{ width: 24 }}>
        #{index + 1}
      </Text>
      <Stepper label="Reps" value={set.reps} step={1} min={1} max={100} onChange={(v) => onChange({ reps: v })} />
      <Stepper
        label="Kg"
        value={set.weight}
        step={2.5}
        min={0}
        max={500}
        decimals={1}
        onChange={(v) => onChange({ weight: v })}
      />
      <Stepper
        label="RPE"
        value={set.rpe ?? 0}
        step={1}
        min={0}
        max={10}
        onChange={(v) => onChange({ rpe: v === 0 ? undefined : v })}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Xoá set"
        onPress={onRemove}
        style={({ pressed }) => [{ padding: spacing.xs }, pressed && { opacity: 0.6 }]}
      >
        <Feather name="trash-2" size={16} color={colors.danger} />
      </Pressable>
    </View>
  );
}
