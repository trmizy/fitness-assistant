import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";

interface ScreenProps extends PropsWithChildren {
  scroll?: boolean;
  padded?: boolean;
  style?: ViewStyle;
  onRefresh?: () => void;
  refreshing?: boolean;
  // Đặt false khi màn tự quản KeyboardAvoidingView riêng (VD: coach
  // thread có input ghim đáy) — tránh lồng 2 KeyboardAvoidingView.
  keyboardAvoiding?: boolean;
}

// Standard SafeArea + padding wrapper used by every screen, mirroring the
// web app's `p-4 md:p-6 max-w-Nxl mx-auto` container convention.
export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  onRefresh,
  refreshing = false,
  keyboardAvoiding = true,
}: ScreenProps) {
  const content = padded ? styles.padded : undefined;

  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[content, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, content, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  padded: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
});
