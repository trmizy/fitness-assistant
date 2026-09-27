import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Building2, ChevronRight, KeyRound, Link2, LogOut, Phone, Users } from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  Input,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { authService, gymService } from "../../src/services/api";
import { useServerSeededState } from "../../src/hooks/useServerSeededState";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import {
  ABOUT_MAX,
  EMPTY_BRAND_PROFILE,
  SOCIAL_FIELDS,
  brandDisplayName,
  brandPendingName,
  brandProfileError,
  brandProfileFrom,
  brandProfilePayload,
  isBrandOwner,
  passwordChangeError,
  payoutDirty,
  payoutError,
  payoutFrom,
  phoneError,
  socialUrlError,
  theBrand,
  type BrandProfileForm,
  type OnboardingProgress,
  type PayoutForm,
} from "../../src/features/gymOwner/gymOwner";

/**
 * WB-18 — "Hồ sơ". Web gọi là `GymOwnerProfilePage`; Figma không vẽ màn này.
 *
 * Bốn thứ sửa được ở đây, và chỉ bốn: thương hiệu (tên + giới thiệu + mạng xã hội), số điện thoại
 * liên hệ, tài khoản nhận tiền, mật khẩu. **Thông tin pháp lý không nằm ở đây** — tên pháp lý, mã
 * số thuế và giấy phép đã qua Gymini xác minh, sửa tự do thì lần xác minh đó thành vô nghĩa.
 *
 * Quản lý chi nhánh chỉ thấy số điện thoại và mật khẩu của chính họ: máy chủ thậm chí không trả
 * `payout` cho họ, và thương hiệu là của chủ sở hữu.
 *
 * Lưu tên thương hiệu là TẠO MỘT YÊU CẦU chờ Gymini duyệt, nên `brandProfilePayload` chỉ gửi `name`
 * khi tên thật sự đổi — nếu không, lưu mỗi link mạng xã hội cũng đẻ ra một yêu cầu đổi tên vô nghĩa.
 */
export default function GymOwnerProfileScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, logout } = useApp();
  const uid = user?.id ?? "guest";

  const statusKey = ["partner-onboarding-status", uid];
  const statusQuery = useQuery({ queryKey: statusKey, queryFn: () => gymService.getOnboardingStatus() });
  const brandsQuery = useQuery({ queryKey: ["owned-brands", uid], queryFn: () => gymService.listOwnedBrands() });

  const progress = (statusQuery.data ?? null) as OnboardingProgress | null;
  const brand = theBrand(brandsQuery.data) as any;
  const isOwner = isBrandOwner(statusQuery.data);

  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || fallback, "danger");

  // ── Thương hiệu ──
  const [brandForm, setBrandForm] = useServerSeededState<BrandProfileForm>(
    brand ? brandProfileFrom(brand) : EMPTY_BRAND_PROFILE,
    JSON.stringify(brand ? brandProfileFrom(brand) : EMPTY_BRAND_PROFILE),
  );
  const brandErr = brandProfileError(brandForm);
  const nameChanged = !!brand && brandForm.name.trim() !== brandProfileFrom(brand).name;

  const saveBrand = useMutation({
    mutationFn: () => gymService.updateBrand(brand.id, brandProfilePayload(brandForm, brand)),
    onSuccess: () => {
      toast.show(
        nameChanged ? "Đã lưu — tên mới hiển thị sau khi Gymini duyệt" : "Đã lưu thông tin thương hiệu",
        "success",
      );
      void qc.invalidateQueries({ queryKey: ["owned-brands", uid] });
    },
    onError: (e) => fail(e, "Không lưu được — kiểm tra lại các link"),
  });

  // ── Liên hệ ──
  const [phone, setPhone] = useServerSeededState(progress?.contactPhone ?? "", progress?.contactPhone ?? "");
  const phoneDirty = phone.trim() !== (progress?.contactPhone ?? "");
  const savePhone = useMutation({
    mutationFn: () => gymService.submitOnboardingContact(phone.trim()),
    onSuccess: () => {
      toast.show("Đã cập nhật số điện thoại", "success");
      void qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e) => fail(e, "Không cập nhật được số điện thoại"),
  });

  // ── Tài khoản nhận tiền ──
  const [payout, setPayout] = useServerSeededState<PayoutForm>(payoutFrom(progress), JSON.stringify(payoutFrom(progress)));
  const savePayout = useMutation({
    mutationFn: () =>
      gymService.submitOnboardingPayout({
        bankName: payout.bankName.trim(),
        accountNumber: payout.accountNumber.trim(),
        accountHolder: payout.accountHolder.trim(),
      }),
    onSuccess: () => {
      toast.show("Đã cập nhật tài khoản nhận tiền", "success");
      void qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e) => fail(e, "Không cập nhật được tài khoản nhận tiền"),
  });

  // ── Mật khẩu ──
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const pwErr = passwordChangeError(pw.current, pw.next, pw.confirm);
  const changePassword = useMutation({
    mutationFn: () => authService.changePassword({ currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      toast.show("Đã đổi mật khẩu", "success");
    },
    onError: (e) => fail(e, "Không đổi được mật khẩu — kiểm tra lại mật khẩu hiện tại"),
  });

  const loading = statusQuery.isLoading || brandsQuery.isLoading;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={statusQuery.isRefetching}
            onRefresh={() => {
              void statusQuery.refetch();
              void brandsQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Hồ sơ</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground" numberOfLines={1}>
            {user?.email}
          </Text>
          <View className="mt-2 flex-row">
            <Badge tone={isOwner ? "success" : "info"}>{isOwner ? "Chủ phòng gym" : "Quản lý chi nhánh"}</Badge>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : (
          <Stagger className="gap-5 px-5 pt-5">
            {isOwner && brand ? (
              <StaggerItem>
                <Card className="gap-3 p-5">
                  <SectionTitle icon={Building2} title="Thương hiệu" />
                  {brandPendingName(brand) ? (
                    <Text className="font-body text-[11px] text-warning">
                      Tên mới đang chờ Gymini duyệt: {brandPendingName(brand)}
                    </Text>
                  ) : (
                    <Text className="font-body text-[11px] text-muted-foreground">
                      Khách đang thấy: {brandDisplayName(brand)}
                    </Text>
                  )}
                  <Input
                    label="Tên thương hiệu"
                    value={brandForm.name}
                    onChangeText={(v) => setBrandForm((f) => ({ ...f, name: v }))}
                    placeholderTextColor={inputPlaceholderColor}
                  />
                  <Input
                    label={`Giới thiệu · ${brandForm.description.length}/${ABOUT_MAX}`}
                    value={brandForm.description}
                    onChangeText={(v) => setBrandForm((f) => ({ ...f, description: v.slice(0, ABOUT_MAX) }))}
                    placeholder="Một vài dòng về thương hiệu"
                    placeholderTextColor={inputPlaceholderColor}
                    multiline
                    numberOfLines={3}
                  />

                  <View className="flex-row items-center gap-1.5 pt-1">
                    <Link2 size={13} color={designTokens.mutedForeground} />
                    <Text className="font-body text-xs text-muted-foreground">Trang mạng xã hội của thương hiệu</Text>
                  </View>
                  {SOCIAL_FIELDS.map((s) => (
                    <Input
                      key={s.key}
                      label={s.label}
                      value={brandForm[s.key]}
                      onChangeText={(v) => setBrandForm((f) => ({ ...f, [s.key]: v }))}
                      placeholder={s.placeholder}
                      placeholderTextColor={inputPlaceholderColor}
                      autoCapitalize="none"
                      keyboardType="url"
                      error={socialUrlError(s.key, brandForm[s.key])}
                    />
                  ))}

                  <Button disabled={!!brandErr || saveBrand.isPending} onPress={() => saveBrand.mutate()}>
                    {saveBrand.isPending ? "Đang lưu…" : nameChanged ? "Lưu (tên mới cần Gymini duyệt)" : "Lưu thương hiệu"}
                  </Button>
                  <Hint error={brandErr} />
                </Card>
              </StaggerItem>
            ) : null}

            <StaggerItem>
              <Card className="gap-3 p-5">
                <SectionTitle icon={Phone} title="Liên hệ" />
                <Input
                  label="Số điện thoại"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="0901234567"
                  placeholderTextColor={inputPlaceholderColor}
                />
                <Button
                  variant="secondary"
                  disabled={!phoneDirty || !!phoneError(phone) || savePhone.isPending}
                  onPress={() => savePhone.mutate()}
                >
                  {savePhone.isPending ? "Đang lưu…" : "Lưu số điện thoại"}
                </Button>
                <Hint error={phoneDirty ? phoneError(phone) : null} />
              </Card>
            </StaggerItem>

            {/* Máy chủ không trả `payout` cho quản lý chi nhánh — không vẽ ô họ không được sửa. */}
            {isOwner ? (
              <StaggerItem>
                <Card className="gap-3 p-5">
                  <SectionTitle icon={Banknote} title="Tài khoản nhận tiền" />
                  <Text className="font-body text-[11px] leading-4 text-muted-foreground">
                    Gymini chuyển khoản tay tới tài khoản này sau khi bạn gửi yêu cầu rút, nên tên chủ tài khoản
                    phải khớp giấy tờ.
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
                    placeholderTextColor={inputPlaceholderColor}
                  />
                  <Input
                    label="Chủ tài khoản"
                    value={payout.accountHolder}
                    onChangeText={(v) => setPayout((p) => ({ ...p, accountHolder: v }))}
                    placeholder="NGUYEN VAN A"
                    placeholderTextColor={inputPlaceholderColor}
                  />
                  <Button
                    variant="secondary"
                    disabled={!payoutDirty(payout, progress) || !!payoutError(payout) || savePayout.isPending}
                    onPress={() => savePayout.mutate()}
                  >
                    {savePayout.isPending ? "Đang lưu…" : "Lưu tài khoản nhận tiền"}
                  </Button>
                  <Hint error={payoutDirty(payout, progress) ? payoutError(payout) : null} />
                </Card>
              </StaggerItem>
            ) : null}

            {isOwner ? (
              <StaggerItem>
                <Card className="overflow-hidden">
                  <Tappable
                    accessibilityLabel="Người quản lý chi nhánh"
                    onPress={() => router.push("/gym-owner/managers")}
                    className="flex-row items-center gap-3 p-4"
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                      <Users size={18} color={accent.primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground">Người quản lý chi nhánh</Text>
                      <Text className="font-body text-xs text-muted-foreground">
                        Mời người vận hành giúp bạn, mỗi người một tài khoản riêng
                      </Text>
                    </View>
                    <ChevronRight size={16} color={designTokens.mutedForeground} />
                  </Tappable>
                </Card>
              </StaggerItem>
            ) : null}

            <StaggerItem>
              <Card className="gap-3 p-5">
                <SectionTitle icon={KeyRound} title="Đổi mật khẩu" />
                <Input
                  label="Mật khẩu hiện tại"
                  value={pw.current}
                  onChangeText={(v) => setPw((p) => ({ ...p, current: v }))}
                  secureTextEntry
                  placeholderTextColor={inputPlaceholderColor}
                />
                <Input
                  label="Mật khẩu mới"
                  value={pw.next}
                  onChangeText={(v) => setPw((p) => ({ ...p, next: v }))}
                  secureTextEntry
                  placeholderTextColor={inputPlaceholderColor}
                />
                <Input
                  label="Nhập lại mật khẩu mới"
                  value={pw.confirm}
                  onChangeText={(v) => setPw((p) => ({ ...p, confirm: v }))}
                  secureTextEntry
                  placeholderTextColor={inputPlaceholderColor}
                />
                <Button variant="secondary" disabled={!!pwErr || changePassword.isPending} onPress={() => changePassword.mutate()}>
                  {changePassword.isPending ? "Đang đổi…" : "Đổi mật khẩu"}
                </Button>
                <Hint error={pw.current || pw.next || pw.confirm ? pwErr : null} />
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="gap-2 border-border/70 p-4">
                <Text className="font-body text-[11px] leading-4 text-muted-foreground">
                  Tên pháp lý, mã số thuế và giấy phép kinh doanh đã được Gymini xác minh nên không sửa ở đây.
                  Cần đổi thì liên hệ Gymini.
                </Text>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Button variant="destructive" icon={LogOut} onPress={() => void logout()}>
                Đăng xuất
              </Button>
            </StaggerItem>
          </Stagger>
        )}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Phone; title: string }) {
  const accent = useWorkspaceAccent();
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={16} color={accent.primary} />
      <Text className="font-display text-base text-foreground">{title}</Text>
    </View>
  );
}

function Hint({ error }: { error: string | null }) {
  if (!error) return null;
  return <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text>;
}
