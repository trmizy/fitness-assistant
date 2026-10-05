import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Building2, Mail } from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, inputPlaceholderColor, useToast } from "../../src/components/ui";
import { partnerApplyPublic, type PartnerApplyStartResult } from "../../src/services/api";
import {
  applyEmailError,
  friendlyError,
} from "../../src/features/partnerApplication/partnerApplication";

/**
 * WB-15 — "Trở thành đối tác". Màn công khai: chưa có tài khoản nào, nên không có gì ở đây đi qua
 * lớp xác thực.
 *
 * Gửi email xong **không** chuyển sang màn khác mà đổi ngay tại chỗ thành trạng thái "đã gửi": trên
 * điện thoại người dùng sẽ rời app sang hộp thư rồi quay lại, và quay lại đúng chỗ cũ dễ hiểu hơn là
 * rơi vào một màn lạ.
 *
 * `devVerifyLink` chỉ xuất hiện khi máy chủ bật cờ dev — mã gốc không được lưu ở đâu cả, nên đây là
 * đường duy nhất để thử luồng này mà không cần hộp thư thật. Có thì bày ra kèm nút chép, không thì
 * không nhắc tới.
 */
export default function PartnerApplyScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<PartnerApplyStartResult | null>(null);

  const start = useMutation({
    mutationFn: () => partnerApplyPublic.start(email.trim()),
    onSuccess: (data) => setSent(data),
    onError: (e) => toast.show(friendlyError(e, "Không gửi được liên kết xác minh"), "danger"),
  });

  const error = applyEmailError(email);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/login"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Trở thành đối tác" onBack={back} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
      >
        {!sent ? (
          <>
            <Card className="gap-3 p-5">
              <Building2 size={22} color="#60a5fa" />
              <Text className="font-display text-base text-foreground">Đưa phòng gym của bạn lên Gymini</Text>
              <Text className="font-body text-sm leading-6 text-muted-foreground">
                Nhập email của bạn. Gymini gửi một liên kết xác minh; mở liên kết đó để đặt mật khẩu và bắt đầu
                khai hồ sơ.
              </Text>
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="ban@phonggym.vn"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Button disabled={!!error || start.isPending} onPress={() => start.mutate()}>
                {start.isPending ? "Đang gửi…" : "Gửi liên kết xác minh"}
              </Button>
              {error && email ? (
                <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text>
              ) : null}
            </Card>

            <Card className="mt-4 gap-2 border-border/70 p-4">
              <Text className="font-body text-[11px] leading-4 text-muted-foreground">
                Email đã dùng cho tài khoản khách, huấn luyện viên hay quản trị viên thì không đăng ký đối tác
                được — hãy dùng một email khác.
              </Text>
            </Card>

            {/* 14B.6 (PG-B9) — someone invited to MANAGE a branch does not apply; they accept the invite. */}
            <Button variant="ghost" className="mt-3" onPress={() => router.push("/partner/invite")}>
              Tôi được mời làm quản lý chi nhánh
            </Button>
          </>
        ) : (
          <Card className="gap-3 p-5">
            <Mail size={22} color="#60a5fa" />
            <Text className="font-display text-base text-foreground">
              {sent.status === "DELIVERY_FAILED" ? "Chưa gửi được thư" : "Đã gửi liên kết"}
            </Text>
            <Text className="font-body text-sm leading-6 text-muted-foreground">
              {sent.status === "DELIVERY_FAILED"
                ? `Không gửi được thư tới ${sent.email}. Hãy kiểm tra lại địa chỉ rồi thử lần nữa.`
                : `Kiểm tra hộp thư ${sent.email} và mở liên kết trong đó. Liên kết dùng được trong ${sent.expiresInHours} giờ.`}
            </Text>

            {sent.devVerifyLink ? (
              <>
                <View className="rounded-xl border border-border bg-panel p-3">
                  <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={3}>
                    {sent.devVerifyLink}
                  </Text>
                </View>
                <Text className="font-body text-[11px] text-muted-foreground">
                  Liên kết này chỉ hiện ở môi trường phát triển.
                </Text>
                <Button
                  variant="secondary"
                  onPress={async () => {
                    await Clipboard.setStringAsync(sent.devVerifyLink!);
                    toast.show("Đã sao chép liên kết", "success");
                  }}
                >
                  Sao chép liên kết
                </Button>
              </>
            ) : null}

            <Button onPress={() => router.push("/partner/verify")}>Tôi đã có liên kết</Button>
            <Button variant="ghost" onPress={() => setSent(null)}>
              Gửi lại hoặc đổi email
            </Button>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
