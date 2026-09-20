import type { ReactNode } from "react";
import { Text, View } from "react-native";

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

/**
 * Status pill — the reference's `Badge`. Tones are semantic, not colours: a screen says what the
 * state MEANS and the palette decides how it looks, which is what lets the workspace accent
 * re-tint `success` without touching any screen.
 *
 * Split into container/label classes for the same reason as Button: RN text does not inherit
 * colour from its parent View.
 */
const container: Record<BadgeTone, string> = {
  success: "bg-primary/15",
  warning: "bg-warning/15",
  danger: "bg-destructive/15",
  info: "bg-chart-3/15",
  neutral: "bg-panel",
};

const label: Record<BadgeTone, string> = {
  success: "text-primary",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-chart-3",
  neutral: "text-muted-foreground",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <View
      className={`flex-row items-center gap-1 self-start rounded-full px-2.5 py-0.5 ${container[tone]} ${className}`}
    >
      {typeof children === "string" ? (
        <Text className={`text-xs font-body-semibold ${label[tone]}`}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}
