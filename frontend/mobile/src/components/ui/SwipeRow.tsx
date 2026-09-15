import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { LucideIcon } from "lucide-react-native";

import { haptics } from "../../lib/haptics";
import { darkColors } from "../../theme/colors";
import { springSnap, swipe } from "../../theme/motion";

/**
 * Swipe-left-to-reveal-an-action row — the reference's `SwipeRow` (96px action, elastic 0.08,
 * releases past 48px snap open, spring 400/34).
 *
 * `activeOffsetX` is the one addition the web version did not need: without it the pan competes
 * with the enclosing vertical scroll and the list becomes hard to scroll over these rows. Requiring
 * ~12px of horizontal travel before claiming the gesture lets a vertical flick pass straight
 * through.
 *
 * A haptic fires as the row crosses the commit threshold — the same "you can let go now" signal the
 * bottom sheet gives.
 */
export function SwipeRow({
  children,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  className = "",
}: {
  children: ReactNode;
  actionLabel: string;
  actionIcon: LucideIcon;
  onAction: () => void;
  className?: string;
}) {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const passedThreshold = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onBegin(() => {
      startX.value = translateX.value;
    })
    .onUpdate((event) => {
      const next = startX.value + event.translationX;

      if (next < -swipe.actionWidth) {
        // Past the action's width: keep moving, but resist — the reference's dragElastic.
        translateX.value =
          -swipe.actionWidth + (next + swipe.actionWidth) * swipe.elasticity;
      } else if (next > 0) {
        translateX.value = next * swipe.elasticity;
      } else {
        translateX.value = next;
      }

      const past = event.translationX < -swipe.commitThreshold;
      if (past !== passedThreshold.value) {
        passedThreshold.value = past;
        if (past) runOnJS(haptics.threshold)();
      }
    })
    .onEnd((event) => {
      passedThreshold.value = false;
      const open = event.translationX < -swipe.commitThreshold;
      translateX.value = withSpring(open ? -swipe.actionWidth : 0, springSnap);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const actionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-swipe.actionWidth, 0], [1, 0], "clamp"),
  }));

  const close = () => {
    translateX.value = withSpring(0, springSnap);
  };

  return (
    <View className={`relative overflow-hidden rounded-2xl ${className}`}>
      <Animated.View
        className="absolute inset-y-0 right-0 w-24 items-center justify-center rounded-2xl bg-destructive/20"
        style={actionStyle}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          className="items-center gap-1"
          onPress={() => {
            haptics.tap();
            close();
            onAction();
          }}
        >
          <ActionIcon size={20} color={darkColors.destructive} />
          <Text className="text-xs font-body-semibold text-destructive">{actionLabel}</Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
