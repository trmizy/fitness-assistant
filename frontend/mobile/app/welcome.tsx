import { useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ArrowRight, Dumbbell, LineChart, Sparkles, type LucideIcon } from "lucide-react-native";

import { Button, Tappable } from "../src/components/ui";
import { Preferences } from "../src/services/storage";
import { darkColors } from "../src/theme/colors";
import { useWorkspaceAccent } from "../src/theme/workspace";

/**
 * SH-02 — the first-run intro.
 *
 * Visual authority: `New Frontend/src/screens/Onboarding.tsx` (three slides, full-bleed photo under
 * a bottom-up gradient, icon tile, display heading on two lines, growing dot for the active slide).
 * There is no web counterpart at all — web drops a visitor straight on /login — so nothing here is
 * ported behaviour; it calls no API and decides nothing.
 *
 * It lives at the root rather than inside `(auth)` on purpose: that group pads the top inset for its
 * form screens, which would leave a band above a photo meant to run under the status bar.
 *
 * Shown once per install: the flag is written on "Bỏ qua" and on "Bắt đầu ngay" alike, because both
 * mean "I have seen this". Signed-in users never reach it — see app/index.tsx.
 */
export const INTRO_SEEN_KEY = "intro.seen";

const SLIDES: { icon: LucideIcon; title: string; body: string; image: string }[] = [
  {
    icon: Dumbbell,
    title: "Phòng gym cá nhân\ntrong túi của bạn",
    body: "Giáo án, nhật ký tập và chu kỳ periodization — tất cả ở một nơi.",
    image: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&h=1000&fit=crop&auto=format",
  },
  {
    icon: Sparkles,
    title: "AI Coach\nhiểu cơ thể bạn",
    body: "Phân tích InBody, tạo giáo án và điều chỉnh dinh dưỡng theo tiến độ thật.",
    image: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&h=1000&fit=crop&auto=format",
  },
  {
    icon: LineChart,
    title: "Kết nối PT\n& phòng gym",
    body: "Tìm huấn luyện viên, đặt lịch, mua gói hội viên — thanh toán an toàn.",
    image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&h=1000&fit=crop&auto=format",
  },
];

/** The design's easing for both transitions: a long settle, no overshoot. */
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export default function WelcomeScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  const isLast = index === SLIDES.length - 1;

  // Photo: fade in from a slight zoom (1.08 → 1) over 600ms, as the reference does on every slide.
  const photoOpacity = useSharedValue(0);
  const photoScale = useSharedValue(1.08);
  // Copy: fade up 20px over 400ms, a beat quicker than the photo so the words lead.
  const copyOpacity = useSharedValue(0);
  const copyShift = useSharedValue(20);

  useEffect(() => {
    photoOpacity.value = 0;
    photoScale.value = 1.08;
    copyOpacity.value = 0;
    copyShift.value = 20;
    photoOpacity.value = withTiming(1, { duration: 600, easing: EASE });
    photoScale.value = withTiming(1, { duration: 600, easing: EASE });
    copyOpacity.value = withTiming(1, { duration: 400, easing: EASE });
    copyShift.value = withTiming(0, { duration: 400, easing: EASE });
  }, [index, photoOpacity, photoScale, copyOpacity, copyShift]);

  const photoStyle = useAnimatedStyle(() => ({
    opacity: photoOpacity.value,
    transform: [{ scale: photoScale.value }],
  }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: copyOpacity.value,
    transform: [{ translateY: copyShift.value }],
  }));

  const finish = async () => {
    // Write before navigating: a user who kills the app on the login screen should not be shown the
    // intro again on the next launch.
    await Preferences.set({ key: INTRO_SEEN_KEY, value: "1" });
    // Back to the root redirect rather than straight to /login: someone who opened this screen with
    // a live session (a deep link, a reinstall that kept the keychain) belongs in their workspace,
    // and it already knows where each role lands. Caught on the emulator — finishing the intro while
    // signed in as john.doe showed a login form.
    router.replace("/");
  };

  return (
    <View className="flex-1 bg-background">
      <Animated.View style={[{ position: "absolute", inset: 0 }, photoStyle]}>
        <Image
          // Only the photo is remote; every word and control above it is local, so a slow or missing
          // image costs the gradient's backdrop, never the screen.
          source={{ uri: slide.image }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
          recyclingKey={slide.image}
        />
        <LinearGradient
          colors={[`${darkColors.background}4d`, `${darkColors.background}d9`, darkColors.background]}
          locations={[0, 0.55, 1]}
          style={{ position: "absolute", inset: 0 }}
        />
      </Animated.View>

      <View className="flex-1" style={{ paddingTop: insets.top + 20 }}>
        <View className="flex-row items-center justify-between px-6">
          <View className="flex-row items-center gap-1.5">
            <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Dumbbell size={16} strokeWidth={2.75} color={accent.onPrimary} />
            </View>
            <Text className="font-display text-lg text-foreground">Gymini</Text>
          </View>
          {/* The last slide has no "Bỏ qua": its own button already says "Bắt đầu ngay". */}
          {isLast ? null : (
            <Tappable haptic={false} onPress={finish}>
              <Text className="font-body-semibold text-sm text-muted-foreground">Bỏ qua</Text>
            </Tappable>
          )}
        </View>

        <View className="flex-1" />

        <View className="px-6" style={{ paddingBottom: insets.bottom + 28 }}>
          <Animated.View style={copyStyle}>
            <View className="mb-5 h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
              <Icon size={24} color={accent.primary} />
            </View>
            <Text
              className="font-display text-4xl text-foreground"
              // The reference sets leading 1.05 on a 4xl display line; NativeWind's leading scale has
              // no such step, so it is set here against the real font size.
              style={{ lineHeight: Math.round(36 * 1.05) }}
            >
              {slide.title}
            </Text>
            <Text className="mt-4 max-w-[300px] font-body text-[15px] leading-relaxed text-muted-foreground">
              {slide.body}
            </Text>
          </Animated.View>

          <View className="mb-7 mt-8 flex-row gap-2">
            {SLIDES.map((s, i) => (
              <Dot key={s.image} active={i === index} />
            ))}
          </View>

          <Button
            full
            size="lg"
            icon={isLast ? undefined : ArrowRight}
            onPress={() => (isLast ? void finish() : setIndex((i) => i + 1))}
          >
            {isLast ? "Bắt đầu ngay" : "Tiếp tục"}
          </Button>
        </View>
      </View>

      {/* Keeps the gradient's darkest band tall enough for the copy on short screens. */}
      {height < 640 ? <View className="absolute inset-x-0 bottom-0 h-40 bg-background/40" /> : null}
    </View>
  );
}

/** Its own component so each dot can hold the hook its width animation needs. */
function Dot({ active }: { active: boolean }) {
  const width = useSharedValue(active ? 28 : 8);

  useEffect(() => {
    width.value = withTiming(active ? 28 : 8, { duration: 280, easing: EASE });
  }, [active, width]);

  const style = useAnimatedStyle(() => ({ width: width.value }));

  return (
    <Animated.View
      className={`h-2 rounded-full ${active ? "bg-primary" : "bg-border"}`}
      style={style}
    />
  );
}
