import { Linking, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { LifeBuoy } from "lucide-react-native";

import { Button, ScreenHeader } from "../../src/components/ui";
import { useWorkspaceAccent } from "../../src/theme/workspace";

const SUPPORT_EMAIL = "support@fitnessassistant.vn";

/**
 * Deliberately NOT a self-service reset form.
 *
 * Checked against the backend before building anything (source-of-truth order: the running API
 * first, documents second): auth-service exposes `POST /auth/password-reset`, but it consumes a
 * token that arrives in an ADMIN-issued partner invite link — `authService.resetPasswordWithToken`.
 * There is no route anywhere that lets a user request a reset for their own email. Web's own
 * "Quên mật khẩu?" link points back at /login for exactly this reason.
 *
 * So this screen tells the truth instead of collecting an email address that nothing would ever
 * act on. Recorded in MOBILE_BACKEND_GAPS.md; replace this with the real flow if and when the
 * endpoint exists — and do not invent it frontend-side in the meantime.
 */
export default function ForgotPasswordScreen() {
  const accent = useWorkspaceAccent();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Quên mật khẩu" onBack={() => router.back()} />

      <ScrollView contentContainerClassName="p-6">
        <View className="mb-6 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <LifeBuoy size={26} color={accent.primary} />
        </View>

        <Text className="font-display text-2xl text-foreground">
          Đặt lại mật khẩu qua hỗ trợ
        </Text>
        <Text className="mt-3 font-body leading-6 text-muted-foreground">
          Hiện chưa có chức năng tự đặt lại mật khẩu. Vui lòng liên hệ bộ phận hỗ trợ kèm địa chỉ
          email đăng ký, chúng tôi sẽ xác minh và cấp lại quyền truy cập cho bạn.
        </Text>

        <View className="mt-6 rounded-2xl border border-border bg-card p-4">
          <Text className="text-xs font-body-medium uppercase text-muted-foreground">
            Email hỗ trợ
          </Text>
          <Text className="mt-1 font-body-semibold text-foreground">{SUPPORT_EMAIL}</Text>
        </View>

        <Button
          full
          size="lg"
          className="mt-6"
          onPress={() => {
            void Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Yêu cầu đặt lại mật khẩu")}`,
            );
          }}
        >
          Gửi email hỗ trợ
        </Button>

        <Button variant="ghost" full className="mt-2" onPress={() => router.back()}>
          Quay lại đăng nhập
        </Button>
      </ScrollView>
    </View>
  );
}
