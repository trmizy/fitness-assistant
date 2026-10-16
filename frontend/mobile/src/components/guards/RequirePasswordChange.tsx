import type { ReactNode } from "react";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react-native";

import { Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../ui";
import { useApp } from "../../context/AppContext";
import { authService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { friendlyError, PASSWORD_MIN, newPasswordError } from "../../features/partnerApplication/partnerApplication";

/**
 * WB-01 — tài khoản còn cờ `mustChangePassword` (được cấp mật khẩu tạm) không được dùng gì cho tới
 * khi đặt mật khẩu mới. Không có nút bỏ qua, không có đường vòng: màn này chặn toàn bộ ứng dụng, chỉ
 * còn "Đăng xuất".
 *
 * Trước Phase 12 cờ này chỉ nằm trong kiểu dữ liệu `User` mà **không có gì đọc nó** — một tài khoản
 * mang mật khẩu tạm dùng được cả ứng dụng như thường.
 *
 * Tối thiểu **8** ký tự, đúng `changePasswordSchema` của auth-service. Web ghi 6 ở màn tương đương
 * nên người dùng web gõ 7 ký tự sẽ bị máy chủ trả 400 — đó là chỗ web lệch, không phải chỗ để chép
 * theo.
 *
 * `changePassword` **xoá mọi refresh token** của người dùng (auth.service.ts) và không cấp lại, nên
 * phiên hiện tại sẽ chết ở lần làm mới token kế tiếp. Vì vậy đổi xong là đăng xuất luôn và nói rõ
 * phải đăng nhập lại — thà nói trước còn hơn để họ bị văng ra giữa chừng mà không hiểu vì sao.
 */
export function RequirePasswordChange({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const { user, isAuthenticated, logout } = useApp();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: () => authService.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      toast.show("Đã đổi mật khẩu — hãy đăng nhập lại", "success");
      await logout();
    },
    onError: (e) => toast.show(friendlyError(e, "Không đổi được mật khẩu — kiểm tra lại mật khẩu hiện tại"), "danger"),
  });

  if (!isAuthenticated || !user?.mustChangePassword) return <>{children}</>;

  const error = !current ? "Nhập mật khẩu tạm đã được cấp." : newPasswordError(next, confirm);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }}
      >
        <View className="items-center gap-3">
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-warning/15">
            <KeyRound size={26} color={accent.primary} />
          </View>
          <Text className="text-center font-display text-xl text-foreground">Đặt mật khẩu mới</Text>
          <Text className="text-center font-body text-sm leading-6 text-muted-foreground">
            Tài khoản của bạn đang dùng mật khẩu tạm. Hãy đặt mật khẩu riêng trước khi tiếp tục.
          </Text>
        </View>

        <Card className="mt-5 gap-3 p-5">
          <Input
            label="Mật khẩu tạm"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label={`Mật khẩu mới (tối thiểu ${PASSWORD_MIN} ký tự)`}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label="Nhập lại mật khẩu mới"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholderTextColor={inputPlaceholderColor}
          />
          <Button disabled={!!error || change.isPending} onPress={() => change.mutate()}>
            {change.isPending ? "Đang đổi…" : "Đặt mật khẩu"}
          </Button>
          {error && (current || next || confirm) ? (
            <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text>
          ) : null}
          <Text className="text-center font-body text-[11px] text-muted-foreground">
            Đổi xong bạn sẽ được đưa về màn đăng nhập để vào lại bằng mật khẩu mới.
          </Text>
        </Card>

        <Tappable accessibilityLabel="Đăng xuất" onPress={() => void logout()} className="mt-6 self-center p-2">
          <Text className="font-body text-xs text-muted-foreground">Đăng xuất</Text>
        </Tappable>
      </ScrollView>
    </View>
  );
}
