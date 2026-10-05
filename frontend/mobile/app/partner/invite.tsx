import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Handshake, Link2, TriangleAlert } from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, inputPlaceholderColor, useToast } from "../../src/components/ui";
import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { INVITE_ROLE_LABEL, extractInviteToken, friendlyError, inviteFormError } from "../../src/features/partnerApplication/partnerApplication";

/**
 * WB-02 / 14B.6 (PG-B9) — accept an invitation to a gym partner (today: a branch MANAGER invited by
 * the owner; owner invitations are retired — see WB-17). Web `PartnerInviteAcceptPage`: preview the
 * invitation, set name + password, then sign in.
 *
 * The emailed link is a web page (`…/partner/invite/<token>`); opening an https link straight in the
 * app needs verified App Links (GAP-20). So, like the WB-15 verify screen, the token arrives by the app
 * deep link `fitnessassistant://partner/invite?token=…`, or the person pastes the link / token.
 */
export default function PartnerInviteScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { login } = useApp();
  const params = useLocalSearchParams<{ token?: string }>();

  const [pasted, setPasted] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; role: string; partnerName: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", password: "", confirm: "" });
  const autoTried = useRef(false);

  const preview = useMutation({
    mutationFn: (t: string) => gymService.previewPartnerInvitation(t),
    onSuccess: (data: any, t) => {
      setToken(t);
      setPreviewError(null);
      setInvite({ email: String(data?.email ?? ""), role: String(data?.role ?? ""), partnerName: String(data?.partnerName ?? "") });
    },
    onError: (e) => {
      setInvite(null);
      setPreviewError(friendlyError(e, "Thư mời không hợp lệ hoặc đã hết hạn."));
    },
  });

  const accept = useMutation({
    mutationFn: () =>
      gymService.acceptPartnerInvitation(token!, {
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
      }),
    onSuccess: async () => {
      const ok = invite?.email ? await login(invite.email, form.password).catch(() => false) : false;
      toast.show(ok ? "Đã tạo tài khoản" : "Đã tạo tài khoản — hãy đăng nhập để tiếp tục", "success");
      router.replace(ok ? "/" : "/login");
    },
    onError: (e) => toast.show(friendlyError(e, "Không thể chấp nhận thư mời"), "danger"),
  });

  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    void (async () => {
      const fromParam = typeof params.token === "string" ? params.token : "";
      const initial = (await Linking.getInitialURL()) ?? "";
      const t = extractInviteToken(fromParam) ?? extractInviteToken(initial);
      if (t) preview.mutate(t);
    })();
    // Chỉ chạy một lần khi mở màn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pastedToken = extractInviteToken(pasted);
  const formError = inviteFormError(form);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/login"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Lời mời đối tác" onBack={back} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 14 }}>
        {preview.isPending ? (
          <Card className="items-center gap-3 p-8">
            <ActivityIndicator color="#60a5fa" />
            <Text className="font-body text-sm text-muted-foreground">Đang mở thư mời…</Text>
          </Card>
        ) : invite ? (
          <Card className="gap-3 p-5">
            <Handshake size={22} color="#22c55e" />
            <Text className="font-display text-base text-foreground">Lời mời đối tác phòng tập</Text>
            <Text className="font-body text-sm leading-6 text-muted-foreground">
              {`${invite.partnerName || "Một đối tác Gymini"} mời bạn tham gia với vai trò `}
              <Text className="font-body-semibold text-primary">{INVITE_ROLE_LABEL[invite.role] ?? invite.role}</Text>.
            </Text>
            <Text className="font-body text-xs text-muted-foreground">{`Email: ${invite.email}`}</Text>
            <View className="flex-row gap-2">
              <Input className="flex-1" label="Họ *" value={form.firstName} onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))} />
              <Input className="flex-1" label="Tên" value={form.lastName} onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))} />
            </View>
            <Input label="Mật khẩu * (tối thiểu 8 ký tự)" value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} secureTextEntry />
            <Input
              label="Nhập lại mật khẩu *"
              value={form.confirm}
              onChangeText={(v) => setForm((f) => ({ ...f, confirm: v }))}
              secureTextEntry
              error={form.confirm && form.password !== form.confirm ? "Mật khẩu không khớp" : null}
            />
            <Button icon={CircleCheck} disabled={!!formError || accept.isPending} onPress={() => accept.mutate()}>
              {accept.isPending ? "Đang tạo tài khoản…" : "Tạo tài khoản & tiếp tục"}
            </Button>
          </Card>
        ) : (
          <>
            {previewError ? (
              <Card className="gap-2 p-5">
                <TriangleAlert size={22} color="#f59e0b" />
                <Text className="font-display text-base text-foreground">Không thể mở thư mời</Text>
                <Text className="font-body text-sm leading-6 text-muted-foreground">{previewError}</Text>
                <Text className="font-body text-xs text-muted-foreground">Hãy liên hệ người đã gửi thư mời để được gửi lại.</Text>
              </Card>
            ) : null}
            <Card className="gap-3 p-5">
              <Link2 size={22} color="#60a5fa" />
              <Text className="font-display text-base text-foreground">Dán liên kết thư mời</Text>
              <Text className="font-body text-sm leading-6 text-muted-foreground">
                Mở thư mời trong email, sao chép liên kết trong đó rồi dán vào đây. Dán riêng mã cũng được.
              </Text>
              <Input
                label="Liên kết hoặc mã"
                value={pasted}
                onChangeText={setPasted}
                autoCapitalize="none"
                placeholder="https://…/partner/invite/…"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Button disabled={!pastedToken || preview.isPending} onPress={() => preview.mutate(pastedToken!)}>
                Mở thư mời
              </Button>
              {pasted && !pastedToken ? (
                <Text className="text-center font-body text-xs text-muted-foreground">Không tìm thấy mã trong nội dung vừa dán.</Text>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
