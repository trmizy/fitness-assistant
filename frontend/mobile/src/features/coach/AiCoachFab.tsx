import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Sparkles } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { designTokens } from "../../theme/colors";
import { workspaceAccents } from "../../theme/workspace";

// The five client tab roots. The button floats over these only: on a pushed screen it would sit on
// top of that screen's own bottom bar (a chat input, a wizard's Next button).
const TAB_ROOTS = new Set(["/client/dashboard", "/client/workout", "/client/services", "/client/messages", "/client/profile"]);

// Tab bar height set in WorkspaceTabs + the design's 20px gap above it (bottom: safe-bottom + 82px).
const TAB_BAR_HEIGHT = 62;

// The attention ring plays this many cycles and then STOPS (B16). It used to repeat forever, which kept
// the render thread busy on every tab (75-95% CPU on a low-end phone, release build) and stopped
// uiautomator from ever seeing the screen as idle. At rest the ring is fully transparent (pulse = 1).
const PULSE_CYCLES = 2;
const PULSE_CYCLE_MS = 1800;

/**
 * WB-12 — the design's `AICoachFab` (App.tsx): 56px primary circle, Sparkles, a pulsing ring and a
 * warning-coloured "live" dot, springing in 400ms after the workspace appears. Web shows the same
 * entry as `AICoachFloatingButton` for clients and for a PT in client mode — the client layout
 * admits exactly those two roles.
 */
export function AiCoachFab() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const accent = workspaceAccents.client;
  const visible = TAB_ROOTS.has(pathname);

  const reduceMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);

  const enter = useSharedValue(0);
  const pulse = useSharedValue(1); // 1 = resting (ring invisible)
  useEffect(() => {
    enter.value = withDelay(400, withSpring(1, { stiffness: 300, damping: 20 }));
  }, [enter]);

  // A short, finite pulse each time the button (re)appears on a tab root or the app returns to the
  // foreground. Never runs while hidden, backgrounded or when the OS asks for reduced motion.
  const pulsing = visible && appActive && !reduceMotion;
  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    // Each cycle snaps to 0 (ring at full size/opacity) then fades out to the resting 1.
    pulse.value = withDelay(
      600,
      withRepeat(
        withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: PULSE_CYCLE_MS, easing: Easing.out(Easing.ease) })),
        PULSE_CYCLES,
        false,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse]);

  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ scale: enter.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - pulse.value), transform: [{ scale: 1 + 0.55 * pulse.value }] }));

  if (!visible) return null;

  return (
    <Animated.View pointerEvents="box-none" style={[{ position: "absolute", right: 16, bottom: insets.bottom + TAB_BAR_HEIGHT + 20 }, enterStyle]}>
      <Tappable
        accessibilityLabel="Mở AI Coach"
        onPress={() => router.push("/client/ai-coach")}
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: accent.primary,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: accent.primary,
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        <Animated.View style={[{ position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: accent.primary }, ringStyle]} />
        <Sparkles size={24} strokeWidth={2.5} color={accent.onPrimary} />
        <View
          style={{
            position: "absolute",
            right: 2,
            top: 2,
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: accent.onPrimary,
            backgroundColor: designTokens.warning,
          }}
        />
      </Tappable>
    </Animated.View>
  );
}
