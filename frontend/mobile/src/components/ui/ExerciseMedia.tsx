import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Dumbbell, Play } from "lucide-react-native";

import { exerciseMediaFrames } from "../../features/library/exerciseMedia";
import { useWorkspaceAccent } from "../../theme/workspace";

/**
 * The demo image for one exercise.
 *
 * The catalog stores two still JPGs per exercise, not a GIF (see `exerciseMedia.ts`), so the
 * movement is shown the way web does it: cross-fade between the start and end frame. `animate` is
 * opt-in because a list of 30 rows all fading on their own timers is motion nobody asked for and
 * work the scroll thread does not need — list thumbnails stay on the first frame.
 *
 * `expo-image` rather than RN's `Image`: it caches to disk, so the catalog does not re-download on
 * every visit (the Phase 0.5 image strategy called this out for exactly this screen).
 */
export function ExerciseMedia({
  videoUrl,
  className = "",
  animate = false,
  badge = false,
  iconSize = 20,
}: {
  videoUrl: string | null | undefined;
  /** Sizing/rounding comes from the caller — a 44px thumbnail and a 16:9 hero share this component. */
  className?: string;
  animate?: boolean;
  badge?: boolean;
  iconSize?: number;
}) {
  const accent = useWorkspaceAccent();
  const { first, second, canAnimate } = exerciseMediaFrames(videoUrl);
  const animating = animate && canAnimate;

  const secondOpacity = useSharedValue(0);
  const [showSecond, setShowSecond] = useState(false);

  useEffect(() => {
    if (!animating) return;
    // Same 900 ms beat as web's ExerciseMediaPreview, so the two clients read as one product.
    const timer = setInterval(() => setShowSecond((value) => !value), 900);
    return () => clearInterval(timer);
  }, [animating]);

  useEffect(() => {
    secondOpacity.value = withTiming(animating && showSecond ? 1 : 0, { duration: 300 });
  }, [animating, showSecond, secondOpacity]);

  const secondStyle = useAnimatedStyle(() => ({ opacity: secondOpacity.value }));

  // 217 of the 1090 catalog rows have no media at all — they keep the icon they had before.
  if (!first) {
    return (
      <View className={`items-center justify-center bg-primary/15 ${className}`}>
        <Dumbbell size={iconSize} color={accent.primary} />
      </View>
    );
  }

  return (
    <View className={`overflow-hidden bg-panel ${className}`}>
      <Image
        source={{ uri: first }}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        recyclingKey={first}
      />
      {animating && second ? (
        <Animated.View style={[{ position: "absolute", inset: 0 }, secondStyle]}>
          <Image
            source={{ uri: second }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={second}
          />
        </Animated.View>
      ) : null}
      {badge ? (
        <View className="absolute left-2 top-2 flex-row items-center gap-1 rounded-full bg-black/55 px-2 py-1">
          <Play size={10} color="#ffffff" fill="#ffffff" />
          <Text className="font-body-semibold text-[10px] text-white">
            {canAnimate ? "Demo" : "Media"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
