import { useEffect, useState } from "react";
import { Text, type TextProps } from "react-native";
import { useAnimatedReaction, useSharedValue, withTiming, runOnJS } from "react-native-reanimated";

import { timingCount } from "../../theme/motion";

/**
 * Number that animates up from zero — the reference's `CountUp` (0.8s, the design's single easing
 * curve, `toLocaleString("en-US")` so thousands are grouped).
 *
 * Formatted text cannot be driven from the UI thread (building the string is JS work), so the
 * animation runs as a shared value and only the FORMATTED RESULT crosses back, at most once per
 * frame. That keeps the easing exact while leaving the string work where it has to happen.
 *
 * The locale is pinned to en-US to match the reference: grouping stays "1,234" rather than
 * following the device locale, which would render "1.234" on a Vietnamese phone and read as a
 * decimal.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  ...textProps
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
} & TextProps) {
  const format = (value: number) =>
    value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const progress = useSharedValue(0);
  const [display, setDisplay] = useState(() => format(0));

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(to, timingCount);
  }, [to, progress]);

  useAnimatedReaction(
    () => progress.value,
    (value, previous) => {
      if (value === previous) return;
      runOnJS(setDisplay)(
        value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
      );
    },
    [decimals],
  );

  return (
    <Text className={className} {...textProps}>
      {prefix}
      {display}
      {suffix}
    </Text>
  );
}
