import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ClipboardList, LogOut } from "lucide-react-native";

import { Button, Card, useToast } from "../../src/components/ui";
import { useApp } from "../../src/context/AppContext";
import { profileService } from "../../src/services/api";
import { ROLE_HOME } from "../../src/config/landing";
import { useWorkspaceAccent } from "../../src/theme/workspace";

/**
 * Onboarding wizard — SHELL ONLY for Phase 4.
 *
 * The real wizard (age/gender/height/weight/goal/experience/activity level) is Phase 5's, and
 * inventing a half-version here is exactly the mistake web made once: it grew a second, incomplete
 * copy of the profile form that skipped a field and mislabelled an enum, and every new user had to
 * click through two wizards back to back. So this collects nothing.
 *
 * What it DOES do is close the routing loop that Phase 4 has to prove: `RequireOnboarding` sends
 * an unfinished client here, and "Bỏ qua" writes `hasCompletedOnboarding` so the guard lets them
 * through on the next check — which is how the register → OTP → dashboard path can be tested
 * end-to-end before the wizard exists.
 *
 * Not under the tab bar on purpose: a user who has not finished setup should not see tabs into
 * parts of the app their profile is not ready for.
 */
export default function ClientOnboardingScreen() {
  const { user, logout } = useApp();
  const toast = useToast();
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();

  const skipForNow = async () => {
    try {
      await profileService.updateProfile({ hasCompletedOnboarding: true });
      router.replace(ROLE_HOME.client);
    } catch {
      toast.show("Không lưu được. Kiểm tra kết nối rồi thử lại.", "danger");
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-6 gap-5"
      contentContainerStyle={{ paddingTop: insets.top + 16 }}
    >
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
        <ClipboardList size={26} color={accent.primary} />
      </View>

      <View>
        <Text className="font-display text-2xl text-foreground">Thiết lập hồ sơ</Text>
        <Text className="mt-1.5 font-body leading-6 text-muted-foreground">
          Chào {user?.firstName ?? "bạn"}! Trình hướng dẫn thật (mục tiêu, chỉ số cơ thể, mức độ
          vận động) sẽ được dựng ở Phase 5. Tạm thời bạn có thể bỏ qua để vào ứng dụng.
        </Text>
      </View>

      <Card className="p-4">
        <Text className="text-xs font-body-medium uppercase text-muted-foreground">
          Vì sao cần bước này
        </Text>
        <Text className="mt-1.5 font-body text-sm leading-5 text-muted-foreground">
          Kế hoạch tập luyện và dinh dưỡng do AI tạo dựa trên hồ sơ này, nên nó được hỏi một lần
          duy nhất ở đây thay vì rải rác trong lúc đăng ký.
        </Text>
      </Card>

      <Button full size="lg" onPress={skipForNow}>
        Bỏ qua, vào ứng dụng
      </Button>

      <Button variant="ghost" icon={LogOut} full onPress={logout}>
        Đăng xuất
      </Button>
    </ScrollView>
  );
}
