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
  locale = "en-US",
  className,
  ...textProps
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Digit grouping. Money in VND uses "vi-VN" (26.353.275) to match formatVND elsewhere. */
  locale?: string;
  className?: string;
} & TextProps) {
  const progress = useSharedValue(0);
  // The raw number crosses to JS and is formatted there — Intl locales other than en-US are not
  // guaranteed on the UI-thread runtime.
  const [value, setValue] = useState(0);
  const display = value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(to, timingCount);
  }, [to, progress]);

  useAnimatedReaction(
    () => progress.value,
    (v, previous) => {
      if (v === previous) return;
      runOnJS(setValue)(v);
    },
    [],
  );

  return (
    <Text className={className} {...textProps}>
      {prefix}
      {display}
      {suffix}
    </Text>
  );
}
