import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";

import { darkColors } from "../../theme/colors";
import { haptics } from "../../lib/haptics";

/**
 * Heading above a group of cards — the reference's `SectionHeader`.
 * `items-end` is deliberate: it optically aligns the small action link with the title's baseline
 * rather than its box.
 */
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View className="mb-3 flex-row items-end justify-between px-1">
      <Text className="font-display text-lg text-foreground">{title}</Text>
      {action ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onAction?.();
          }}
          hitSlop={8}
        >
          <Text className="text-sm font-body-semibold text-primary">{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Sub-screen top bar with a back affordance — the reference's `ScreenHeader`.
 *
 * The reference pads with `--safe-top`, a CSS variable it defines with a fixed floor because its
 * phone frame is simulated; here the real inset is read from the device, which is the whole point
 * of having safe-area context. `glass` is approximated with the design's translucent fill — RN has
 * no backdrop-filter, and a real blur (expo-blur) is reserved for surfaces where content actually
 * scrolls underneath and the blur is visible.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center gap-2 border-b border-border bg-glass px-3 pb-3"
      style={{ paddingTop: insets.top + 12 }}
    >
      <Pressable
        onPress={() => {
          haptics.tap();
          onBack();
        }}
        accessibilityRole="button"
        accessibilityLabel="Quay lại"
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full"
      >
        <ChevronLeft size={24} color={darkColors.foreground} />
      </Pressable>
      <Text className="flex-1 font-display text-lg text-foreground" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}
