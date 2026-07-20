import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../src/store/authStore";
import { queryClient } from "../src/api/queryClient";
import { startAutoSyncListener, syncQueuedWorkoutLogs } from "../src/offline/syncEngine";
import { colors } from "../src/ui";

export default function RootLayout() {
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
    startAutoSyncListener();
    // Also try once on cold start — NetInfo's listener only fires on
    // subsequent connectivity *changes*, not the initial known state.
    void syncQueuedWorkoutLogs();
  }, [bootstrap]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          {isBootstrapping ? (
            <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <Stack screenOptions={{ headerShown: false }} />
          )}
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
