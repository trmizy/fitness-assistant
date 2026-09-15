import { useEffect } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * Loading placeholder.
 *
 * Not in the reference's shared component file — the design shows loaded screens only — so the
 * shape is derived from its surfaces rather than invented: a `bg-panel` block with the same corner
 * radii the real content uses, pulsing opacity so it reads as "pending" rather than "empty".
 *
 * The pulse runs on the UI thread and keeps running while the JS thread is blocked by whatever is
 * loading, which is exactly when a skeleton needs to look alive.
 */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      className={`rounded-xl bg-panel ${className}`}
      style={[style, animatedStyle]}
    />
  );
}

/** The common case: a few stacked lines standing in for a paragraph or a list row's text. */
export function SkeletonLines({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <View className={`gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className="h-3.5 rounded-md"
          // Last line short, as real text usually is — a block of equal-length bars reads as a
          // table, not a paragraph.
          style={{ width: index === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </View>
  );
}
