import { useState } from "react";
import { LayoutChangeEvent, Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { haptics } from "../../lib/haptics";
import { springSnap } from "../../theme/motion";

/**
 * Segmented control — the reference's `Segmented`.
 *
 * The reference animates the active pill with motion's `layoutId`, a shared-layout transition that
 * has no RN equivalent. The same effect is produced explicitly: ONE indicator view is kept mounted
 * and its x/width are sprung to the selected segment (same spring, 400/34), which is what
 * `layoutId` does under the hood anyway.
 *
 * Segment width is measured rather than computed from a percentage, so a container with padding or
 * an odd pixel width cannot leave the indicator a hair off.
 */
export function Segmented({
  options,
  value,
  onChange,
  className = "",
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [segmentWidth, setSegmentWidth] = useState(0);
  const indicatorX = useSharedValue(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    // Subtract the container's own p-1 (4px each side) before dividing.
    const inner = event.nativeEvent.layout.width - 8;
    const width = options.length > 0 ? inner / options.length : 0;
    setSegmentWidth(width);
    indicatorX.value = width * Math.max(0, options.indexOf(value));
  };

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View className={`flex-row rounded-xl bg-panel p-1 ${className}`} onLayout={handleLayout}>
      {segmentWidth > 0 ? (
        <Animated.View
          className="absolute left-1 top-1 bottom-1 rounded-lg border border-border bg-card"
          style={[{ width: segmentWidth }, indicatorStyle]}
          pointerEvents="none"
        />
      ) : null}

      {options.map((option, index) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className="flex-1 items-center rounded-lg py-2"
            onPress={() => {
              if (selected) return;
              haptics.selection();
              indicatorX.value = withSpring(segmentWidth * index, springSnap);
              onChange(option);
            }}
          >
            <Text
              className={`text-sm font-body-semibold ${
                selected ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
