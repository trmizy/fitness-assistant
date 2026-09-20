import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { darkColors } from "../../theme/colors";
import { timingProgress } from "../../theme/motion";
import { useWorkspaceAccent } from "../../theme/workspace";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Ring that sweeps to a percentage — the reference's `ProgressRing` (84px, 8px stroke, rotated
 * -90° so the sweep starts at twelve o'clock, 1s on the design's easing curve).
 *
 * Geometry is the reference's exactly: radius `(size - stroke) / 2` keeps the stroke inside the
 * box, and the sweep is a `strokeDashoffset` animation from the full circumference down to
 * `c - c * progress`.
 *
 * `useAnimatedProps` rather than state: the offset is an SVG attribute, so it can be updated on
 * the UI thread every frame without re-rendering the React tree underneath — which matters because
 * these rings usually sit on a dashboard with several of them plus a list.
 */
export function ProgressRing({
  progress,
  size = 84,
  stroke = 8,
  color,
  trackColor = darkColors.panel,
  children,
  className,
}: {
  /** 0..1. Values above 1 are clamped, matching the reference. */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: ReactNode;
  className?: string;
}) {
  const accent = useWorkspaceAccent();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const offset = useSharedValue(circumference);

  useEffect(() => {
    const target = circumference - circumference * Math.min(Math.max(progress, 0), 1);
    offset.value = withTiming(target, timingProgress);
  }, [progress, circumference, offset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));

  return (
    <View className={className} style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color ?? accent.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
        />
      </Svg>
      <View className="absolute inset-0 items-center justify-center">{children}</View>
    </View>
  );
}
