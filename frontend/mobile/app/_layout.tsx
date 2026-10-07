import "../src/theme/global.css";

import { useEffect } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Slot } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts as useBarlowFonts, Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold, Barlow_800ExtraBold, Barlow_900Black } from "@expo-google-fonts/barlow";
import { useFonts as useInterFonts, Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from "@expo-google-fonts/inter";

import { darkColors } from "../src/theme/colors";
import { queryClient } from "../src/lib/queryClient";
import { AppProvider } from "../src/context/AppContext";
import { RequirePasswordChange } from "../src/components/guards/RequirePasswordChange";
import { SocketProvider } from "../src/context/SocketContext";
import { ToastProvider } from "../src/components/ui";
import { PushManager } from "../src/features/push/PushManager";
import { RealtimeRefresh } from "../src/features/notifications/RealtimeRefresh";
import { CallProvider } from "../src/features/call/CallProvider";
import { CallOverlay } from "../src/features/call/CallOverlay";

// GestureHandlerRootView must wrap the whole app (react-native-gesture-handler's own
// requirement), and SafeAreaProvider must sit above every screen that reads insets.
//
// Both were unusable for most of Phase 1 — see MOBILE_PLATFORM_ADAPTERS.md §16, now resolved: the
// cause was two copies of react-native in the bundle (one reached via the short-path junction, one
// via pnpm's store path), which meant two of every module-level singleton inside it. metro.config.js
// now forces a single copy.

// Hold the native splash screen up until fonts finish loading — same intent as web's
// font-swap flicker avoidance, but RN has no FOUT fallback so this hold is load-bearing,
// not cosmetic (see Phase 1 "Xong khi": headings must render in Barlow/body in Inter from
// the very first frame, never a system-font flash first).
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [barlowLoaded] = useBarlowFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    Barlow_800ExtraBold,
    Barlow_900Black,
  });
  const [interLoaded] = useInterFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const fontsReady = barlowLoaded && interLoaded;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <View style={{ flex: 1, backgroundColor: darkColors.background }}>
            <StatusBar style="light" />
            {/* AppProvider restores the session before rendering anything below it, so no screen
                ever sees a half-known auth state (see src/services/session.ts). ToastProvider sits
                inside it but above every screen, so a toast is never clipped by a screen's own
                stacking context. */}
            <AppProvider>
              {/* SocketProvider reads the session from AppProvider, so it must sit inside it. */}
              <SocketProvider>
                <ToastProvider>
                  {/* WB-01 — mật khẩu tạm phải đổi trước khi dùng bất cứ thứ gì. Đặt TRONG
                      ToastProvider để chính màn chặn cũng hiện được thông báo, và bọc ngoài
                      `Slot` để không một route nào lọt qua. */}
                  {/* Phase 14.4 — calls: the provider listens for call:* on chat-service's socket for
                      the whole session; the overlay is a full-screen Modal over any screen. */}
                  <CallProvider>
                    {/* One keyboard handler for every screen. The app is edge-to-edge (Android 15+
                        enforces it), so adjustResize no longer shrinks the window when the keyboard
                        opens and fields low on a screen — a chat composer, a wizard step — sat behind
                        it (real phone, 6/10). Padding here gives back the resize; a focused input in
                        a ScrollView is then scrolled into view by Android itself. Sheets are Modals
                        (their own window) and handle the keyboard themselves. */}
                    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "android" ? "padding" : undefined}>
                      <RequirePasswordChange>
                        <Slot />
                      </RequirePasswordChange>
                    </KeyboardAvoidingView>
                    <CallOverlay />
                  </CallProvider>
                  {/* Phase 14.2 — phone push: registers this device, routes taps. Renders nothing. */}
                  <PushManager />
                  {/* Server events (socket or foreground push) refresh the lists they touch. */}
                  <RealtimeRefresh />
                </ToastProvider>
              </SocketProvider>
            </AppProvider>
          </View>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
