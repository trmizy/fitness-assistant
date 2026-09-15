import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Redirect, router, usePathname } from "expo-router";

import { useApp, type UserRole } from "../../context/AppContext";
import { ROLE_HOME } from "../../config/landing";
import { Button } from "../ui";

/**
 * Workspace-level role guard — wraps a whole role's route subtree, so a mismatch never renders
 * that workspace's tab bar or any screen inside it.
 *
 * As on web, this is strictly a UX guard, NOT a security boundary: only the backend's RBAC decides
 * what data an account can reach. It stops a client from *seeing* the PT workspace by following a
 * deep link; it protects nothing by itself.
 *
 * Session restore resolves before anything below AppProvider renders (see services/session.ts), so
 * by the time this runs `isAuthenticated: false` is a settled answer rather than a still-loading
 * one — there is no "role loading" state to guard against.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: UserRole[];
  children: ReactNode;
}) {
  const { role, isAuthenticated } = useApp();
  const pathname = usePathname();

  // Carry where they were headed, so a session that drops mid-flow (a payment result, say) can
  // return there after logging back in instead of stranding them on a dashboard.
  if (!isAuthenticated) {
    return <Redirect href={{ pathname: "/login", params: { from: pathname } }} />;
  }

  if (!allow.includes(role)) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <View className="w-full max-w-md rounded-2xl border border-warning/20 bg-warning/5 p-6">
          <Text className="mb-2 text-center font-display text-lg text-warning">
            403 — Không có quyền truy cập
          </Text>
          <Text className="text-center text-sm font-body text-muted-foreground">
            Tài khoản của bạn không có quyền xem trang này.
          </Text>

          {/*
            Web could leave this a dead end — there is always an address bar or a back button that
            goes somewhere. Here, the hardware back key pops to whatever sits under this route, and
            when the blocked route IS the bottom of the stack (arriving by deep link, say) back
            quits the app instead. So the way out is explicit.
          */}
          <Button className="mt-5" variant="secondary" full onPress={() => router.replace(ROLE_HOME[role])}>
            Về trang chủ của bạn
          </Button>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}
