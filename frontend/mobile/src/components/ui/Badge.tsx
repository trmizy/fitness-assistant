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
      {isPlainText(children) ? (
        // One unbreakable line. On Android screens with a fractional density (e.g. 2.625, 3.5) the native
        // text view can get a sub-pixel less width than Yoga measured; with a space to break at, it wrapped
        // the last word onto a second line the pill had no room for ("Đã duyệt" showed as "Đã"). With
        // non-breaking spaces and clipping, the worst case is one invisible pixel.
        <Text numberOfLines={1} ellipsizeMode="clip" className={`text-xs font-body-semibold ${label[tone]}`}>
          {unbreakable(children)}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

/**
 * `{count} buổi có ghi` reaches here as an ARRAY (number + string), not a string — rendering
 * that straight into the View was a "Text strings must be rendered within <Text>" error on
 * the exercise-progress screen. Anything made only of strings/numbers is label text.
 */
function isPlainText(node: ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") return true;
  return Array.isArray(node) && node.length > 0 && node.every((n) => typeof n === "string" || typeof n === "number");
}

function unbreakable(node: ReactNode): string {
  return (Array.isArray(node) ? node.join("") : String(node)).replace(/ /g, "\u00A0");
}
