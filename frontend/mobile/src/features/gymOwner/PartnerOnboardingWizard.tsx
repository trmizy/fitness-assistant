import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Check, FileText, Phone, Store } from "lucide-react-native";

import { Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { gymService } from "../../services/api";
import { useServerSeededState } from "../../hooks/useServerSeededState";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import {
  ABOUT_MAX,
  brandNameError,
  onboardingStepIndex,
  payoutError,
  payoutFrom,
  phoneError,
  visibleOnboardingSteps,
  type OnboardingProgress,
  type PayoutForm,
} from "./gymOwner";

/**
 * GY-08 — trình thiết lập lần đầu của đối tác: liên hệ → thương hiệu → nhận tiền → điều khoản.
 * Đây cũng là thứ đứng giữa trạng thái `APPROVED_PAYOUT_PENDING` và không gian vận hành, nên
 * `RequirePartnerAccess` dẫn tới đây thay vì chỉ giải thích suông như trước.
 *
 * **Bước đang dở tính từ máy chủ, không giữ ở client** (`currentStep` của `getOnboardingStatus`):
 * đóng app giữa chừng rồi mở lại phải rơi đúng chỗ cũ, và điều đó tự đúng khi không có bản sao tiến
 * độ nào ở máy.
 *
 * Không có nút thoát. Thoát khỏi thiết lập không phải là hoàn tất nó — chỉ có "Đăng xuất", đúng như
 * web. Quản lý chi nhánh chỉ thấy bước liên hệ; ba bước còn lại là việc của chủ sở hữu và máy chủ
 * cũng chỉ đòi bước đó ở họ.
 */
export function PartnerOnboardingWizard() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, logout } = useApp();
  const uid = user?.id ?? "guest";

  const key = ["partner-onboarding-status", uid];
  const query = useQuery({ queryKey: key, queryFn: () => gymService.getOnboardingStatus() });
  const progress = (query.data ?? null) as OnboardingProgress | null;

  const steps = visibleOnboardingSteps(progress);
  const index = onboardingStepIndex(progress);
  const current = steps[index]?.key ?? "contact";

  // Mồi sẵn những gì máy chủ đã có — quay lại bước cũ không nên thấy ô trống như chưa từng nhập.
  const [phone, setPhone] = useServerSeededState(progress?.contactPhone ?? "", progress?.contactPhone ?? "");
  const [brand, setBrand] = useState({ name: "", description: "" });
  const [payout, setPayout] = useServerSeededState<PayoutForm>(payoutFrom(progress), JSON.stringify(payoutFrom(progress)));
  const [agreed, setAgreed] = useState(false);


  const onSaved = (data: unknown) => {
    qc.setQueryData(key, data);
    void qc.invalidateQueries({ queryKey: ["partner-access-status", uid] });
  };
  const fail = (e: any) => toast.show(e?.response?.data?.error?.message || "Không lưu được, thử lại sau", "danger");

  const saveContact = useMutation({
    mutationFn: () => gymService.submitOnboardingContact(phone.trim()),
    onSuccess: onSaved,
    onError: fail,
  });
  const saveBrand = useMutation({
    mutationFn: () =>
      gymService.submitOnboardingBrand({
        name: brand.name.trim(),
        description: brand.description.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: fail,
  });
  const savePayout = useMutation({
    mutationFn: () =>
      gymService.submitOnboardingPayout({
        bankName: payout.bankName.trim(),
        accountNumber: payout.accountNumber.trim(),
        accountHolder: payout.accountHolder.trim(),
      }),
    onSuccess: onSaved,
    onError: fail,
  });
  const saveTerms = useMutation({
    mutationFn: () => gymService.submitOnboardingTerms(),
    onSuccess: (d) => {
      onSaved(d);
      toast.show("Đã hoàn tất thiết lập", "success");
    },
    onError: fail,
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }}
      >
        <Text className="font-display text-xl text-foreground">Thiết lập tài khoản đối tác</Text>
        <Text className="mt-1 font-body text-xs text-muted-foreground">
          Bước {index + 1}/{steps.length} · {steps[index]?.label}
        </Text>

        <View className="mt-4 flex-row gap-1.5">
          {steps.map((s, i) => (
            <View key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-panel"}`} />
          ))}
        </View>

        <Card className="mt-5 gap-3 p-5">
          {current === "contact" ? (
            <>
              <StepTitle icon={Phone} title="Xác nhận liên hệ" />
              <Text className="font-body text-xs leading-5 text-muted-foreground">
                Số điện thoại Gymini dùng để liên hệ với bạn về hồ sơ, thanh toán và sự cố tại chi nhánh.
              </Text>
              <Input
                label="Số điện thoại"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="0901234567"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Button
                disabled={!!phoneError(phone) || saveContact.isPending}
                onPress={() => saveContact.mutate()}
              >
                {saveContact.isPending ? "Đang lưu…" : "Tiếp tục"}
              </Button>
              <FormHint error={phoneError(phone)} />
            </>
          ) : null}

          {current === "brand" ? (
            <>
              <StepTitle icon={Store} title="Đặt tên thương hiệu" />
              <Text className="font-body text-xs leading-5 text-muted-foreground">
                Đây là tên khách thấy khi tìm kiếm. Mọi chi nhánh bạn tạo sau này đều thuộc thương hiệu này —
                bạn chỉ có một thương hiệu.
              </Text>
              <Input
                label="Tên thương hiệu"
                value={brand.name}
                onChangeText={(v) => setBrand((b) => ({ ...b, name: v }))}
                placeholder="Ví dụ: Gymini Fitness"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Input
                label={`Giới thiệu (tuỳ chọn) · ${brand.description.length}/${ABOUT_MAX}`}
                value={brand.description}
                onChangeText={(v) => setBrand((b) => ({ ...b, description: v.slice(0, ABOUT_MAX) }))}
                placeholder="Một vài dòng về thương hiệu"
                placeholderTextColor={inputPlaceholderColor}
                multiline
                numberOfLines={3}
              />
              <Button disabled={!!brandNameError(brand.name) || saveBrand.isPending} onPress={() => saveBrand.mutate()}>
                {saveBrand.isPending ? "Đang lưu…" : "Tiếp tục"}
              </Button>
              <FormHint error={brandNameError(brand.name)} />
            </>
          ) : null}

          {current === "payout" ? (
            <>
              <StepTitle icon={Banknote} title="Thông tin nhận tiền" />
              <Text className="font-body text-xs leading-5 text-muted-foreground">
                Tài khoản Gymini chuyển doanh thu của bạn về. Chuyển khoản do Gymini thực hiện tay sau khi bạn
                gửi yêu cầu rút, nên tên chủ tài khoản phải khớp giấy tờ.
              </Text>
              <Input
                label="Ngân hàng"
                value={payout.bankName}
                onChangeText={(v) => setPayout((p) => ({ ...p, bankName: v }))}
                placeholder="Vietcombank"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Input
                label="Số tài khoản"
                value={payout.accountNumber}
                onChangeText={(v) => setPayout((p) => ({ ...p, accountNumber: v }))}
                keyboardType="number-pad"
                placeholder="0123456789"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Input
                label="Chủ tài khoản"
                value={payout.accountHolder}
                onChangeText={(v) => setPayout((p) => ({ ...p, accountHolder: v }))}
                placeholder="NGUYEN VAN A"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Button disabled={!!payoutError(payout) || savePayout.isPending} onPress={() => savePayout.mutate()}>
                {savePayout.isPending ? "Đang lưu…" : "Tiếp tục"}
              </Button>
              <FormHint error={payoutError(payout)} />
            </>
          ) : null}

          {current === "terms" ? (
            <>
              <StepTitle icon={FileText} title="Điều khoản đối tác" />
              <Text className="font-body text-xs leading-5 text-muted-foreground">
                Gymini thu phí nền tảng trên mỗi giao dịch phát sinh qua ứng dụng; phần còn lại về ví chi nhánh
                của bạn và rút được theo yêu cầu. Chi nhánh mới phải qua duyệt trước khi hiện với khách.
              </Text>
              <Tappable
                accessibilityLabel="Đồng ý điều khoản đối tác"
                onPress={() => setAgreed((v) => !v)}
                hitSlop={8}
                className="flex-row items-center gap-3 rounded-xl border border-border bg-panel p-3.5"
              >
                <View
                  className={`h-5 w-5 items-center justify-center rounded-md border ${agreed ? "border-primary bg-primary" : "border-border"}`}
                >
                  {agreed ? <Check size={13} color={accent.onPrimary} /> : null}
                </View>
                <Text className="flex-1 font-body text-sm text-foreground">Tôi đồng ý với điều khoản đối tác</Text>
              </Tappable>
              <Button disabled={!agreed || saveTerms.isPending} onPress={() => saveTerms.mutate()}>
                {saveTerms.isPending ? "Đang lưu…" : "Hoàn tất thiết lập"}
              </Button>
              <FormHint error={agreed ? null : "Cần đồng ý điều khoản để hoàn tất."} />
            </>
          ) : null}
        </Card>

        {/* Không có nút thoát: rời khỏi thiết lập không phải là hoàn tất nó. */}
        <Tappable accessibilityLabel="Đăng xuất" onPress={() => void logout()} className="mt-6 self-center p-2">
          <Text className="font-body text-xs text-muted-foreground">Đăng xuất</Text>
        </Tappable>
      </ScrollView>
    </View>
  );
}

function StepTitle({ icon: Icon, title }: { icon: typeof Phone; title: string }) {
  const accent = useWorkspaceAccent();
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={17} color={accent.primary} />
      <Text className="font-display text-base text-foreground">{title}</Text>
    </View>
  );
}

function FormHint({ error }: { error: string | null }) {
  if (!error) return null;
  return <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text>;
}
