import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link, router, useLocalSearchParams } from "expo-router";
import { ArrowRight, Dumbbell, Lock, Mail, ServerCog } from "lucide-react-native";

import { Button, Input } from "../../src/components/ui";
import { useApp } from "../../src/context/AppContext";
import { Preferences } from "../../src/services/storage";
import {
  ROLE_HOME,
  asValidatedRoute,
  isReturnPathForRole,
  isSafeReturnPath,
  landingPathFor,
  roleOf,
} from "../../src/config/landing";
import { useWorkspaceAccent } from "../../src/theme/workspace";

/**
 * Real login. The layout is the design's `Auth.tsx` (logo tile, display heading, two fields, a
 * full-width primary button, the sign-up line pinned to the bottom); every behaviour below it is
 * ported from web's LoginPage.tsx, which is the authority on what the backend actually does.
 *
 * The error handling is the part worth reading. AppContext's `login()` resolves `false` ONLY for a
 * genuine 401 and rethrows everything else, so a rate limit, a dead network and a 500 each get
 * their own message. Web learned this the hard way during mobile QA: a rate-limited login showed
 * the same "wrong password" text as a real one, and users kept retyping a correct password.
 */
export default function LoginScreen() {
  const { login, isAuthenticated, role } = useApp();
  const accent = useWorkspaceAccent();

  // Where the role guard or a session-expiry redirect grabbed the user from.
  const { from } = useLocalSearchParams<{ from?: string }>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anyone reaching this screen WITH a live session belongs inside the app. Without this, a
  // restored session that landed here for any reason (a deep link, a stale history entry) left the
  // user staring at a login form and retyping a password they never needed — a real reported bug
  // on web.
  useEffect(() => {
    if (!isAuthenticated) return;
    router.replace(
      isSafeReturnPath(from) && isReturnPathForRole(from, role)
        ? asValidatedRoute(from)
        : ROLE_HOME[role],
    );
  }, [isAuthenticated, role, from]);

  const handleLogin = async () => {
    Keyboard.dismiss();
    setLoading(true);
    setError(null);

    try {
      const success = await login(email.trim(), password);
      if (!success) {
        setError("Email hoặc mật khẩu không đúng");
        return;
      }

      // Read the account that just signed in rather than the `role` from context: that value
      // belongs to the previous render and would send the wrong account to the wrong workspace.
      const { value: userStr } = await Preferences.get({ key: "user" });
      const storedUser = JSON.parse(userStr || "{}");

      router.replace(
        isSafeReturnPath(from) && isReturnPathForRole(from, roleOf(storedUser))
          ? asValidatedRoute(from)
          : landingPathFor(storedUser),
      );
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        // Which layer rate-limited decides the shape: the gateway sends plain text, auth-service's
        // own limiter sends `{ error }` JSON with a retry countdown. Show whichever is readable.
        const serverMessage =
          typeof err.response?.data === "string"
            ? err.response.data
            : err.response?.data?.error;
        setError(
          typeof serverMessage === "string" && serverMessage.length > 0
            ? serverMessage
            : "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
        );
      } else if (!err?.response) {
        // No response at all — the server was never reached. Saying "wrong password" here is the
        // single most misleading thing the screen could do.
        setError("Không kết nối được máy chủ. Kiểm tra mạng hoặc cấu hình máy chủ.");
      } else {
        setError("Đã xảy ra lỗi. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow px-6 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-8 mt-4 h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          <Dumbbell size={28} strokeWidth={2.5} color={accent.onPrimary} />
        </View>

        <Text className="font-display text-3xl text-foreground">Chào mừng trở lại</Text>
        <Text className="mt-2 font-body text-muted-foreground">
          Đăng nhập để tiếp tục hành trình của bạn
        </Text>

        {error ? (
          <View className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 p-3">
            <Text className="text-center text-sm font-body text-destructive">{error}</Text>
          </View>
        ) : null}

        <View className="mt-8 gap-3">
          <Input
            icon={Mail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Input
            icon={Lock}
            placeholder="Mật khẩu"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            onSubmitEditing={handleLogin}
            returnKeyType="go"
          />

          {/*
            No self-service password reset exists in the backend — auth-service's /password-reset
            consumes a token from an ADMIN-issued partner invite link, and nothing anywhere issues
            one on a user's own request (verified against auth.routes.ts, not assumed). Web's link
            points back at /login for the same reason. Rather than copy a dead link, this says what
            the user should actually do. Recorded in MOBILE_BACKEND_GAPS.md.
          */}
          <Link href="/forgot-password" asChild>
            <Text className="ml-auto text-sm font-body-semibold text-primary">Quên mật khẩu?</Text>
          </Link>
        </View>

        <Button
          full
          size="lg"
          icon={ArrowRight}
          className="mt-8"
          disabled={loading}
          onPress={handleLogin}
        >
          {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>

        <View className="mt-auto pt-8">
          <Text className="text-center text-sm font-body text-muted-foreground">
            Chưa có tài khoản?{" "}
            <Link href="/register" className="font-body-semibold text-primary">
              Đăng ký
            </Link>
          </Text>

          {/*
            "Cấu hình máy chủ" — doc 08 §4.1 asks for this to stay hidden until needed. It matters
            on a real device: the emulator's default (10.0.2.2) is meaningless on a phone, which
            needs the host's LAN address or a tunnel.
          */}
          <Link href="/server-config" asChild>
            <View className="mt-6 flex-row items-center justify-center gap-1.5">
              <ServerCog size={14} color="#52525b" />
              <Text className="text-xs font-body text-muted-foreground">Cấu hình máy chủ</Text>
            </View>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
