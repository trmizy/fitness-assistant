import { useState, type ReactNode } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import Constants from "expo-constants";
import { useMutation } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  Brain,
  ChevronRight,
  Download,
  Dumbbell,
  KeyRound,
  Link2,
  LogOut,
  Salad,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, Tappable, useToast } from "../../../src/components/ui";
import { NutritionPrefsForm } from "../../../src/components/nutrition/NutritionPrefsForm";
import { authService, profileService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { darkColors, designTokens } from "../../../src/theme/colors";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

// Web's ConnectionsSection — deliberately non-interactive: none of these integrations exist.
const CONNECTIONS = [
  { name: "Apple Health", note: "Cần công cụ nền tảng iOS gốc" },
  { name: "Android Health Connect", note: "Cần công cụ nền tảng Android gốc" },
  { name: "Garmin", note: "Chưa tích hợp" },
  { name: "Fitbit", note: "Chưa tích hợp" },
];

/**
 * SH-08 — "Cài đặt" (web's settings/SettingsPage; the design's Settings.tsx). Sections carried
 * over are the ones with real behaviour on mobile: account (display name, password, log out),
 * nutrition preferences (WB-14's home), notification and equipment links, the AI Coach guarantee,
 * privacy & data (export, import, scoped profile-data deletion), connections ("sắp có"), help.
 *
 * Not carried over, on purpose (a switch that does nothing is worse than none):
 *  - Appearance: the app ships the design's single dark theme and Vietnamese UI.
 *  - Units: mobile screens show cm/kg/kcal only; a metric/imperial toggle would not change them.
 *  - Workout toggles (RPE/RIR, smart prefill, rest timer sound/vibration, wake lock): web's
 *    workout logger reads them; the mobile logger has no such behaviours yet.
 * Recorded in MOBILE_MIGRATION_MANIFEST.md (SH-08).
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user, updateUser, logout } = useApp();

  // Follow the account's name until the user edits the field.
  const [firstNameEdit, setFirstName] = useState<string | null>(null);
  const [lastNameEdit, setLastName] = useState<string | null>(null);
  const firstName = firstNameEdit ?? user?.firstName ?? "";
  const lastName = lastNameEdit ?? user?.lastName ?? "";
  const dirty = firstName.trim() !== (user?.firstName ?? "") || lastName.trim() !== (user?.lastName ?? "");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const pwError =
    newPassword.length > 0 && newPassword.length < 8
      ? "Mật khẩu mới cần ít nhất 8 ký tự."
      : confirmPassword.length > 0 && confirmPassword !== newPassword
        ? "Mật khẩu nhập lại không khớp."
        : null;
  const canChangePassword = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  const nameMutation = useMutation({
    mutationFn: () => authService.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() }),
    onSuccess: () => {
      updateUser({ firstName: firstName.trim(), lastName: lastName.trim() });
      setFirstName(null);
      setLastName(null);
      toast.show("Đã cập nhật tên hiển thị", "success");
    },
    onError: () => toast.show("Không thể cập nhật — thử lại sau", "danger"),
  });
  const passwordMutation = useMutation({
    mutationFn: () => authService.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.show("Đã cập nhật mật khẩu", "success");
    },
    onError: (e: any) => toast.show(e?.response?.data?.error?.message ?? e?.response?.data?.error ?? "Không thể đổi mật khẩu — thử lại sau", "danger"),
  });
  const deleteMutation = useMutation({
    mutationFn: () => profileService.deleteProfileData(),
    onSuccess: () => {
      toast.show("Đã xoá dữ liệu hồ sơ", "success");
      void logout();
    },
    onError: () => toast.show("Không thể xoá dữ liệu — thử lại sau", "danger"),
  });

  const confirmDelete = () =>
    Alert.alert(
      "Xoá dữ liệu hồ sơ?",
      "Xoá thông tin hồ sơ (chiều cao, cân nặng, mục tiêu, tuỳ chọn tập luyện…) và lịch sử trò chuyện AI.\n\nKHÔNG xoá tài khoản đăng nhập, lịch sử tập luyện, hợp đồng PT, giao dịch ví hay tin nhắn chat.\n\nKhông thể hoàn tác. Bạn sẽ được đăng xuất.",
      [
        { text: "Huỷ", style: "cancel" },
        { text: "Xác nhận xoá", style: "destructive", onPress: () => deleteMutation.mutate() },
      ],
    );
  const confirmLogout = () =>
    Alert.alert("Đăng xuất?", "Bạn sẽ cần đăng nhập lại để dùng Gymini.", [
      { text: "Huỷ", style: "cancel" },
      { text: "Đăng xuất", style: "destructive", onPress: () => void logout() },
    ]);

  const version = Constants.expoConfig?.version ?? "—";

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Cài đặt" onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/profile"))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Section icon={UserIcon} title="Tài khoản" description="Tên hiển thị, mật khẩu và đăng xuất">
          <Text className="font-body text-xs text-muted-foreground">Email: {user?.email}</Text>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input label="Họ" value={lastName} onChangeText={setLastName} />
            </View>
            <View className="flex-1">
              <Input label="Tên" value={firstName} onChangeText={setFirstName} />
            </View>
          </View>
          <Button size="sm" disabled={!dirty || !firstName.trim() || nameMutation.isPending} onPress={() => nameMutation.mutate()}>
            {nameMutation.isPending ? "Đang lưu…" : "Lưu tên"}
          </Button>
          <View className="mt-1 gap-3 border-t border-border pt-3">
            <View className="flex-row items-center gap-2">
              <KeyRound size={15} color={designTokens.mutedForeground} />
              <Text className="font-body-semibold text-sm text-foreground">Đổi mật khẩu</Text>
            </View>
            <Input label="Mật khẩu hiện tại" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" />
            <Input label="Mật khẩu mới" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
            <Input label="Nhập lại mật khẩu mới" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" />
            {pwError ? <Text className="font-body text-xs text-destructive">{pwError}</Text> : null}
            <Button size="sm" disabled={!canChangePassword || passwordMutation.isPending} onPress={() => passwordMutation.mutate()}>
              {passwordMutation.isPending ? "Đang đổi…" : "Đổi mật khẩu"}
            </Button>
          </View>
          <Tappable onPress={confirmLogout} className="mt-1 flex-row items-center gap-2 border-t border-border pt-3">
            <LogOut size={16} color={darkColors.destructive} />
            <Text className="font-body-semibold text-sm text-destructive">Đăng xuất</Text>
          </Tappable>
        </Section>

        <Section icon={Salad} title="Dinh dưỡng" description="Ngân sách thực phẩm và vùng miền cho gợi ý món ăn">
          <NutritionPrefsForm />
        </Section>

        <Section icon={Dumbbell} title="Tập luyện" description="Thiết bị bạn có để lọc bài tập phù hợp">
          <LinkRow icon={Dumbbell} label="Thiết bị tập luyện" href="/client/profile/equipment" />
        </Section>

        <Section icon={Bell} title="Thông báo" description="Bật/tắt từng loại thông báo">
          <LinkRow icon={Bell} label="Cài đặt thông báo" href="/client/profile/notification-prefs" />
        </Section>

        <Section icon={Brain} title="AI Coach" description="Không có tuỳ chọn nào ảnh hưởng đến quyết định huấn luyện">
          <View className="flex-row items-start gap-2.5 rounded-lg border border-border bg-panel p-3">
            <ShieldCheck size={16} color={designTokens.mutedForeground} />
            <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
              AI Coach luôn tuân theo giáo án, quy tắc deload và an toàn tập luyện đã thiết lập — không cài đặt nào ở đây ghi đè được các quyết định đó.
            </Text>
          </View>
        </Section>

        <Section icon={ShieldAlert} title="Quyền riêng tư & Dữ liệu" description="Xuất, nhập và quản lý dữ liệu của bạn">
          <LinkRow icon={Download} label="Xuất dữ liệu" hint="JSON hoặc CSV" href="/client/profile/export" />
          <LinkRow icon={Upload} label="Nhập lịch sử tập luyện" hint="Hevy, Strong, FitNotes" href="/client/workout/import" />
          <Tappable onPress={confirmDelete} disabled={deleteMutation.isPending} className="flex-row items-center gap-2 border-t border-border pt-3">
            <Trash2 size={16} color={darkColors.destructive} />
            <Text className="font-body-semibold text-sm text-destructive">{deleteMutation.isPending ? "Đang xoá…" : "Xoá dữ liệu hồ sơ"}</Text>
          </Tappable>
        </Section>

        <Section icon={Link2} title="Kết nối" description="Đồng bộ với ứng dụng sức khoẻ khác — sắp có">
          {CONNECTIONS.map((c) => (
            <View key={c.name} className="flex-row items-center justify-between gap-3 rounded-lg border border-border bg-panel p-3">
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">{c.name}</Text>
                <Text className="mt-0.5 font-body text-xs text-muted-foreground">{c.note}</Text>
              </View>
              <Text className="rounded-full border border-border px-2.5 py-1 font-body-semibold text-[11px] text-muted-foreground">Sắp có</Text>
            </View>
          ))}
        </Section>

        <Section icon={BookOpen} title="Trợ giúp & giới thiệu" description="Kiến thức tập luyện và phiên bản ứng dụng">
          <LinkRow icon={BookOpen} label="Thư viện kiến thức" href="/client/library" />
          <View className="flex-row items-center justify-between">
            <Text className="font-body text-sm text-muted-foreground">Phiên bản</Text>
            <Text className="font-body-semibold text-sm text-foreground">{version}</Text>
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  const accent = useWorkspaceAccent();
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Icon size={17} color={accent.primary} />
        </View>
        <View className="flex-1">
          <Text className="font-display text-base text-foreground">{title}</Text>
          <Text className="font-body text-xs text-muted-foreground">{description}</Text>
        </View>
      </View>
      {children}
    </Card>
  );
}

function LinkRow({ icon: Icon, label, hint, href }: { icon: LucideIcon; label: string; hint?: string; href: Href }) {
  return (
    <Tappable onPress={() => router.push(href)} className="flex-row items-center gap-3 rounded-lg border border-border bg-panel p-3">
      <Icon size={16} color={designTokens.mutedForeground} />
      <Text className="flex-1 font-body-semibold text-sm text-foreground">{label}</Text>
      {hint ? <Text className="font-body text-xs text-muted-foreground">{hint}</Text> : null}
      <ChevronRight size={16} color={designTokens.mutedForeground} />
    </Tappable>
  );
}
