import type { ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { haptics } from "../../lib/haptics";
import { pressScale, springPress } from "../../theme/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press feedback wrapper — the reference's `Tappable` (whileTap scale 0.97, spring 400/25).
 *
 * The scale runs on the UI thread via Reanimated rather than from React state, so the shrink stays
 * smooth while the JS thread is busy handling whatever the press kicked off; that is the whole
 * reason the reference's `whileTap` feels instant and a naive `onPressIn`+setState does not.
 *
 * Haptics are on by default here (native-only polish the web reference could not have) and are
 * turned off with `haptic={false}` for anything that fires its own, stronger feedback instead.
 */
export function Tappable({
  children,
  className,
  style,
  onPress,
  disabled,
  scaleTo = pressScale.surface,
  haptic = true,
  accessibilityLabel,
}: {
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  scaleTo?: number;
  haptic?: boolean;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      className={className}
      style={[style, animatedStyle]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      onPressIn={() => {
        scale.value = withSpring(scaleTo, springPress);
        if (haptic) haptics.tap();
      }}
      onPressOut={() => {
        scale.value = withSpring(1, springPress);
      }}
      onPress={onPress}
    >
      {children}
    </AnimatedPressable>
  );
}
