import { StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "./theme";
import { Text } from "./Text";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export interface BadgeProps {
  label: string;
  tone?: Tone;
}

const TONE_STYLES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.textSecondary },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
  accent: { bg: colors.accentSoft, fg: colors.accent },
};

export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const t = TONE_STYLES[tone];
  return (
    <View style={[styles.base, { backgroundColor: t.bg }]}>
      <View style={[styles.dot, { backgroundColor: t.fg }]} />
      <Text variant="small" color={t.fg} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontWeight: "600",
  },
});
