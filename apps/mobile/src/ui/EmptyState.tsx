import type { ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "./theme";
import { Text } from "./Text";
import { Button } from "./Button";

// Decoupled from any specific icon library — pass an @expo/vector-icons
// component (e.g. `(props) => <Feather name="inbox" {...props} />`) or
// any component accepting `size`/`color`.
export interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.wrapper}>
      {Icon ? (
        <View style={styles.iconWrap}>
          <Icon size={28} color={colors.textMuted} />
        </View>
      ) : null}
      <Text variant="subheading" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text variant="caption" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    textAlign: "center",
  },
  description: {
    textAlign: "center",
  },
  action: {
    marginTop: spacing.md,
  },
});
