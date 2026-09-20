import { Children, isValidElement, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { springEnter, stagger, staggerOffsetY } from "../../theme/motion";

/**
 * Staggered entrance for a list — the reference's `Stagger` / `StaggerItem` pair (children fade in
 * 50ms apart, each rising 12px on a 320/30 spring).
 *
 * The reference propagates timing through motion's variant system, where a parent tells its
 * children when to run. Reanimated has no equivalent, so the parent hands each child its delay by
 * index instead. That is why `Stagger` walks its children rather than just rendering them: it is
 * doing what the variant chain did.
 *
 * A child already wrapped in `StaggerItem` is left alone, so a list can mix plain and custom
 * entrance items.
 */
export function Stagger({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View className={className} style={style}>
      {Children.map(children, (child, index) => {
        if (!isValidElement(child)) return child;
        if (child.type === StaggerItem) return child;
        return <StaggerItem index={index}>{child}</StaggerItem>;
      })}
    </View>
  );
}

export function StaggerItem({
  children,
  index = 0,
  className,
  style,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View
      className={className}
      style={style}
      entering={FadeInDown.springify()
        .stiffness(springEnter.stiffness as number)
        .damping(springEnter.damping as number)
        .delay(stagger.initialDelay + index * stagger.childDelay)
        // FadeInDown enters from ABOVE by default; the design's items rise from below.
        .withInitialValues({ transform: [{ translateY: staggerOffsetY }], opacity: 0 })}
    >
      {children}
    </Animated.View>
  );
}
