import { Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { designTokens } from "../../theme/colors";
import { Button } from "./Button";

/**
 * "Nothing here yet" state.
 *
 * Like Skeleton, not in the reference's shared file — its screens are all populated — so this
 * follows the visual language the design uses for its own empty-ish moments: a muted icon in a
 * `bg-panel/60` circle, a display-font line, a muted explanation, and at most one action.
 *
 * The action is optional on purpose: an empty list the user cannot do anything about (an empty
 * history, say) should not grow a button just because the component offers one.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <View className={`items-center px-8 py-10 ${className}`}>
      {Icon ? (
        <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-panel">
          <Icon size={26} color={designTokens.mutedForeground} />
        </View>
      ) : null}

      <Text className="text-center font-display text-lg text-foreground">{title}</Text>

      {description ? (
        <Text className="mt-1.5 text-center text-sm font-body text-muted-foreground">
          {description}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Button className="mt-5" variant="secondary" size="sm" onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}
