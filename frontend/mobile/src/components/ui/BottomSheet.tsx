import { useEffect, type ReactNode } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptics } from "../../lib/haptics";
import { sheetDismissThreshold, springSheet } from "../../theme/motion";

/**
 * Drag-to-dismiss bottom sheet — the reference's `BottomSheet` (spring 320/34, dismiss past 120px,
 * `rounded-t-3xl`, grabber, translucent backdrop).
 *
 * Three things exist here that the web reference had no need for:
 *
 *  - **Android back button** closes the sheet instead of leaving the screen. A sheet that swallows
 *    nothing and lets back navigate away is the single most common RN sheet bug.
 *  - **Safe-area bottom padding** comes from the real inset rather than the reference's fixed
 *    `--safe-bottom` floor.
 *  - **A threshold haptic.** The sheet buzzes once, while dragging, at the moment the release
 *    would dismiss it — so the user can feel the commit point without watching the screen.
 *
 * The sheet is unmounted while closed (`open === false` renders nothing), matching the reference,
 * which keeps a closed sheet's subtree out of the render path entirely.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const translateY = useSharedValue(screenHeight);
  const backdropOpacity = useSharedValue(0);
  // Latches so the commit haptic fires once per crossing, not once per frame past the threshold.
  const passedThreshold = useSharedValue(false);

  useEffect(() => {
    if (!open) return;
    translateY.value = screenHeight;
    backdropOpacity.value = 0;
    translateY.value = withSpring(0, springSheet);
    backdropOpacity.value = withTiming(1, { duration: 180 });
  }, [open, screenHeight, translateY, backdropOpacity]);

  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [open, onClose]);

  const dragGesture = Gesture.Pan()
    // Lets the component test drive this exact gesture (see __tests__/BottomSheet.test.tsx).
    .withTestId("sheet-drag")
    .onUpdate((event) => {
      // Downward only: dragging up must not detach the sheet from the bottom edge.
      translateY.value = Math.max(0, event.translationY);

      const past = event.translationY > sheetDismissThreshold;
      if (past !== passedThreshold.value) {
        passedThreshold.value = past;
        if (past) runOnJS(haptics.threshold)();
      }
    })
    .onEnd((event) => {
      passedThreshold.value = false;
      if (event.translationY > sheetDismissThreshold) {
        translateY.value = withSpring(screenHeight, springSheet);
        backdropOpacity.value = withTiming(0, { duration: 160 });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, springSheet);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!open) return null;

  return (
    // Wrapped in a Modal so the sheet is always measured against the SCREEN. Without it, an
    // `absolute inset-0` sheet declared inside a ScrollView anchors to the scroll CONTENT instead
    // — on a long screen that puts it thousands of pixels above the viewport, so the backdrop dims
    // and nothing else appears. Making the component self-portaling means no caller has to know
    // where it may legally be declared.
    //
    // `animationType="none"`: the entrance is the design's own spring, not the platform's.
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* A Modal is its own native window on Android, which the app's root GestureHandlerRootView
          does not reach into — without this second root the drag-to-dismiss gesture never fires.
          Styled with `style`, not `className`: NativeWind only rewrites className on components it
          has been taught about, and this one is not among them — a className here is silently
          dropped, which left the sheet laid out from the TOP of the screen. */}
      <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View className="absolute inset-0" style={backdropStyle}>
          <Pressable
            className="flex-1 bg-black/60"
            accessibilityRole="button"
            accessibilityLabel="Đóng"
            onPress={onClose}
          />
        </Animated.View>

        {/* The drag-to-dismiss gesture lives on the handle + title only. Attached to the whole
            sheet (as it first was) it also captured every vertical swipe over the content, so a
            ScrollView inside a tall sheet (Phase 8's intake/check-in/generate forms) could never
            scroll. The sheet is capped at 92% of the screen so long content scrolls inside it. */}
        {/* Sheets hold text fields (revision note, reasons, forms). A Modal is its own window, so
            the activity's adjustResize never reaches it — without this the keyboard simply covered
            the field being typed into and the submit button under it. */}
        <KeyboardAvoidingView behavior="padding">
          <Animated.View
            className="rounded-t-3xl border-t border-border bg-card px-5"
            style={[
              {
                paddingBottom: insets.bottom + 20,
                maxHeight: screenHeight * 0.92,
              },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={dragGesture}>
              <View className="pt-3">
                <View className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" />
                {title ? (
                  <Text className="mb-4 text-center font-display text-lg text-foreground">
                    {title}
                  </Text>
                ) : null}
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
