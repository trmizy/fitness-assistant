import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { KeyRound, Mail, MailCheck, Send } from "lucide-react-native";

import { Button, Input, ScreenHeader, useToast } from "../../src/components/ui";
import { authService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";

const SUPPORT_EMAIL = "support@fitnessassistant.vn";
/** Mirrors auth-service's per-account cooldown, so the button does not invite a request the
 *  server would quietly ignore. */
const RESEND_AFTER_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Self-service password reset (GAP-4, MOBILE_BACKEND_GAPS.md).
 *
 * The user asks for a reset LINK by email — never a password or a code typed back here. The link
 * opens the web page `/dat-lai-mat-khau/:token`, the same page and `POST /auth/password-reset`
 * that admin-issued partner links already use; opening that token inside the app needs deep links,
 * which are Phase 14 (MOBILE_PLATFORM_ADAPTERS.md §7).
 *
 * The confirmation is deliberately conditional ("nếu email này có tài khoản"): the server answers
 * the same for every address so nobody can probe which emails are registered, and this screen must
 * not undo that by claiming more than the server knows it did.
 */
export default function ForgotPasswordScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (target: string) => {
    Keyboard.dismiss();
    const trimmed = target.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      toast.show("Email không hợp lệ", "danger");
      return;
    }

    setLoading(true);
    try {
      await authService.requestPasswordReset(trimmed);
      setSentTo(trimmed);
      setCooldown(RESEND_AFTER_SECONDS);
    } catch (error: any) {
      if (!error?.response) {
        toast.show("Không kết nối được máy chủ.", "danger");
      } else {
        toast.show(error.response.data?.error || "Không gửi được yêu cầu", "danger");
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
      <ScreenHeader title="Quên mật khẩu" onBack={() => router.back()} />

      <ScrollView contentContainerClassName="p-6" keyboardShouldPersistTaps="handled">
        {sentTo === null ? (
          <>
            <View className="mb-6 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <KeyRound size={26} color={accent.primary} />
            </View>

            <Text className="font-display text-2xl text-foreground">Đặt lại mật khẩu</Text>
            <Text className="mt-3 font-body leading-6 text-muted-foreground">
              Nhập email bạn dùng để đăng nhập. Chúng tôi sẽ gửi một liên kết để bạn đặt mật khẩu
              mới.
            </Text>

            <View className="mt-6">
              <Input
                icon={Mail}
                placeholder="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                editable={!loading}
                onSubmitEditing={() => submit(email)}
                returnKeyType="send"
              />
            </View>

            <Button
              full
              size="lg"
              icon={Send}
              className="mt-6"
              disabled={loading}
              onPress={() => submit(email)}
            >
              {loading ? "Đang gửi..." : "Gửi liên kết đặt lại"}
            </Button>
          </>
        ) : (
          <>
            <View className="mb-6 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <MailCheck size={26} color={accent.primary} />
            </View>

            <Text className="font-display text-2xl text-foreground">Kiểm tra hộp thư</Text>
            <Text className="mt-3 font-body leading-6 text-muted-foreground">
              Nếu <Text className="font-body-semibold text-foreground">{sentTo}</Text> có tài
              khoản, chúng tôi đã gửi một liên kết đặt lại mật khẩu. Liên kết có hiệu lực 60 phút và
              chỉ dùng được một lần — mở nó trên điện thoại hoặc máy tính để đặt mật khẩu mới, rồi
              quay lại đây đăng nhập.
            </Text>

            <Button full size="lg" className="mt-6" onPress={() => router.replace("/login")}>
              Về đăng nhập
            </Button>

            <Button
              variant="ghost"
              full
              className="mt-2"
              disabled={loading || cooldown > 0}
              onPress={() => submit(sentTo)}
            >
              {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : "Gửi lại email"}
            </Button>

            <Button
              variant="ghost"
              full
              onPress={() => {
                setSentTo(null);
                setCooldown(0);
              }}
            >
              Dùng email khác
            </Button>
          </>
        )}

        <Text className="mt-8 text-center font-body text-xs leading-5 text-muted-foreground">
          Vẫn không nhận được email?{" "}
          <Text
            className="font-body-semibold text-primary"
            onPress={() => {
              void Linking.openURL(
                `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Yêu cầu đặt lại mật khẩu")}`,
              );
            }}
          >
            Liên hệ hỗ trợ
          </Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
