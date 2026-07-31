import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "./theme";
import { Text } from "./Text";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

const SIZE_PADDING: Record<Size, { v: number; h: number; fontSize: number }> = {
  sm: { v: spacing.sm, h: spacing.md, fontSize: 13 },
  md: { v: spacing.md, h: spacing.lg, fontSize: 15 },
  lg: { v: spacing.md + 2, h: spacing.xl, fontSize: 16 },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const sizeCfg = SIZE_PADDING[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        { paddingVertical: sizeCfg.v, paddingHorizontal: sizeCfg.h },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.onAccent : colors.textPrimary}
        />
      ) : (
        <Text
          variant="bodyStrong"
          style={{ fontSize: sizeCfg.fontSize, color: labelColor[variant] }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const labelColor: Record<Variant, string> = {
  primary: colors.onAccent,
  secondary: colors.textPrimary,
  ghost: colors.accent,
  danger: colors.textPrimary,
};

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  fullWidth: {
    width: "100%",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
});
