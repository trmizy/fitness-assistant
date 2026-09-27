import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, KeyRound, Link2 } from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, inputPlaceholderColor, useToast } from "../../src/components/ui";
import { partnerApplyPublic, type PartnerApplyVerifyResult } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import {
  PASSWORD_MIN,
  extractApplyToken,
  friendlyError,
  newPasswordError,
  verifyResultText,
} from "../../src/features/partnerApplication/partnerApplication";

/**
 * WB-15 (2/2) — mở liên kết xác minh rồi đặt mật khẩu.
 *
 * **Mã nằm ở fragment** (`…/verify#token=…`), không phải query — fragment không đi lên máy chủ,
 * không vào log truy cập, không vào Referer. Vì `expo-router` chỉ bóc `params` từ query, mã phải
 * lấy từ URL thô qua `Linking.getInitialURL()` / sự kiện `url`; xem `extractApplyToken`.
 *
 * **Giới hạn đã biết:** thư của Gymini trỏ tới trang WEB (`…/partner/apply/verify#token=…`), và để
 * một liên kết https mở thẳng ứng dụng thì cần App Links đã xác minh tên miền — chưa có ở môi
 * trường phát triển. Nên màn này nhận mã theo ba đường: deep link `fitnessassistant://partner/verify#token=…`,
 * dán cả liên kết, hoặc dán riêng mã. Ghi vào `MOBILE_BACKEND_GAPS.md`.
 *
 * Xác minh **không tiêu** mã trong thư (chỉ đặt mật khẩu xong mới tiêu), nên mở lại liên kết hay
 * xoay ngang máy giữa chừng đều không làm hỏng gì.
 */
export default function PartnerVerifyScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { login } = useApp();
  const params = useLocalSearchParams<{ token?: string }>();

  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<PartnerApplyVerifyResult | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const autoTried = useRef(false);

  const verify = useMutation({
    mutationFn: (token: string) => partnerApplyPublic.verify(token),
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.show(friendlyError(e, "Không xác minh được liên kết"), "danger"),
  });

  const setPw = useMutation({
    mutationFn: () => partnerApplyPublic.setPassword((result as any).setupToken, password),
    onSuccess: async () => {
      // Máy chủ có trả JWT, nhưng nạp phiên bằng chính đường đăng nhập sẵn có thay vì dựng một chỗ
      // thứ hai biết cách cất token — một đường đã chạy tốt còn hơn hai đường gần giống nhau.
      const email = (result as any)?.email as string | undefined;
      if (email) {
        const ok = await login(email, password).catch(() => false);
        if (ok) {
          toast.show("Đã tạo tài khoản đối tác", "success");
          router.replace("/");
          return;
        }
      }
      toast.show("Đã tạo tài khoản — hãy đăng nhập để tiếp tục", "success");
      router.replace("/login");
    },
    onError: (e) => toast.show(friendlyError(e, "Không đặt được mật khẩu"), "danger"),
  });

  // Mã đến từ deep link: đọc URL thô vì fragment không nằm trong params của router.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    let cancelled = false;
    void (async () => {
      const fromParam = typeof params.token === "string" ? params.token : "";
      const initial = (await Linking.getInitialURL()) ?? "";
      const token = extractApplyToken(fromParam) ?? extractApplyToken(initial);
      if (token && !cancelled) verify.mutate(token);
    })();
    return () => {
      cancelled = true;
    };
    // Chỉ chạy một lần khi mở màn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = result?.status === "VALID";
  const pastedToken = extractApplyToken(pasted);
  const pwError = newPasswordError(password, confirm);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/login"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Xác minh đối tác" onBack={back} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
      >
        {verify.isPending ? (
          <Card className="items-center gap-3 p-8">
            <ActivityIndicator color="#60a5fa" />
            <Text className="font-body text-sm text-muted-foreground">Đang kiểm tra liên kết…</Text>
          </Card>
        ) : valid ? (
          <Card className="gap-3 p-5">
            <CircleCheck size={22} color="#22c55e" />
            <Text className="font-display text-base text-foreground">Đặt mật khẩu</Text>
            <Text className="font-body text-sm leading-6 text-muted-foreground">
              Xác minh xong cho {(result as any).email}. Đặt mật khẩu để tạo tài khoản đối tác.
            </Text>
            <Input
              label={`Mật khẩu (tối thiểu ${PASSWORD_MIN} ký tự)`}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor={inputPlaceholderColor}
            />
            <Input
              label="Nhập lại mật khẩu"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button disabled={!!pwError || setPw.isPending} onPress={() => setPw.mutate()}>
              {setPw.isPending ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
            </Button>
            {pwError && (password || confirm) ? (
              <Text className="text-center font-body text-xs text-muted-foreground">{pwError}</Text>
            ) : null}
          </Card>
        ) : result ? (
          <Card className="gap-3 p-5">
            <KeyRound size={22} color="#f59e0b" />
            <Text className="font-display text-base text-foreground">{verifyResultText(result.status).title}</Text>
            <Text className="font-body text-sm leading-6 text-muted-foreground">
              {verifyResultText(result.status).body}
            </Text>
            <Button onPress={() => router.replace("/partner/apply")}>Yêu cầu liên kết mới</Button>
            <Button variant="ghost" onPress={() => setResult(null)}>
              Dán liên kết khác
            </Button>
          </Card>
        ) : (
          <Card className="gap-3 p-5">
            <Link2 size={22} color="#60a5fa" />
            <Text className="font-display text-base text-foreground">Dán liên kết xác minh</Text>
            <Text className="font-body text-sm leading-6 text-muted-foreground">
              Mở thư Gymini vừa gửi, sao chép liên kết trong đó rồi dán vào đây. Dán riêng mã cũng được.
            </Text>
            <Input
              label="Liên kết hoặc mã"
              value={pasted}
              onChangeText={setPasted}
              autoCapitalize="none"
              multiline
              numberOfLines={3}
              placeholder="https://…/partner/apply/verify#token=…"
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button disabled={!pastedToken || verify.isPending} onPress={() => verify.mutate(pastedToken!)}>
              Xác minh
            </Button>
            {pasted && !pastedToken ? (
              <Text className="text-center font-body text-xs text-muted-foreground">
                Không tìm thấy mã trong nội dung vừa dán.
              </Text>
            ) : null}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
