import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, Info, Plus, Search, UserRound, Users } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { foldVi } from "../../src/components/SelectSheet";
import {
  activeManagers,
  branchName,
  daysSince,
  inviteIsStale,
  inviteManagerError,
  managerName,
  managerScopeLabel,
  ownedGyms,
  pendingManagerInvites,
} from "../../src/features/gymOwner/gymOwner";

/**
 * GY-05 — "Người quản lý". Chủ sở hữu tự mời và thu hồi quản lý chi nhánh, không cần quản trị viên.
 *
 * Một người quản lý được gán theo TỪNG chi nhánh và **không** xem được ví, **không** mời thêm người,
 * **không** sửa được thương hiệu. Màn nói thẳng điều đó trong hộp mời, vì người mời cần biết mình
 * đang trao cái gì.
 *
 * Email mời có thể không gửi được (hạ tầng thư). Khi đó phải cho **sao chép liên kết** chứ không
 * nuốt lỗi — đúng như web làm; nếu không, người được mời không có đường nào vào.
 */
const BRANCH_LIST_LIMIT = 8;

export default function GymOwnerManagersScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [scoped, setScoped] = useState<string[]>([]);
  const [branchQuery, setBranchQuery] = useState("");
  const [created, setCreated] = useState<{ email: string; inviteLink: string; emailSent: boolean } | null>(null);

  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const accountsQuery = useQuery({ queryKey: ["owner-partner-accounts", uid], queryFn: () => gymService.listPartnerAccounts() });
  const invitesQuery = useQuery({ queryKey: ["owner-partner-invitations", uid], queryFn: () => gymService.listPartnerInvitations() });

  const gyms = ownedGyms(gymsQuery.data);
  const managers = activeManagers(accountsQuery.data);
  const invites = pendingManagerInvites(invitesQuery.data);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["owner-partner-accounts", uid] });
    void qc.invalidateQueries({ queryKey: ["owner-partner-invitations", uid] });
  };
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || fallback, "danger");

  const invite = useMutation({
    mutationFn: () => gymService.inviteManager({ email: email.trim(), scopedGymIds: scoped }),
    onSuccess: (data: any) => {
      setCreated({ email: email.trim(), inviteLink: data?.inviteLink ?? "", emailSent: data?.emailSent !== false });
      setInviteOpen(false);
      setEmail("");
      setScoped([]);
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được lời mời"),
  });

  const revokeAccount = useMutation({
    mutationFn: (id: string) => gymService.revokePartnerAccount(id, "Thu hồi bởi chủ sở hữu"),
    onSuccess: () => {
      toast.show("Đã thu hồi quyền quản lý", "success");
      invalidate();
    },
    onError: (e) => fail(e, "Không thu hồi được"),
  });

  const resend = useMutation({
    mutationFn: (id: string) => gymService.resendManagerInvitation(id),
    onSuccess: async (data: any) => {
      if (data?.inviteLink) await Clipboard.setStringAsync(String(data.inviteLink));
      toast.show("Đã gửi lại thư mời — liên kết đã được sao chép", "success");
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi lại được thư mời"),
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => gymService.revokeManagerInvitation(id),
    onSuccess: () => {
      toast.show("Đã thu hồi thư mời", "success");
      invalidate();
    },
    onError: (e) => fail(e, "Không thu hồi được thư mời"),
  });

  const askRevoke = (id: string, who: string) =>
    Alert.alert("Thu hồi quyền quản lý?", `${who} sẽ không còn vận hành được chi nhánh nào của bạn.`, [
      { text: "Không", style: "cancel" },
      { text: "Thu hồi", style: "destructive", onPress: () => revokeAccount.mutate(id) },
    ]);

  const error = useMemo(() => inviteManagerError(email, scoped), [email, scoped]);

  const visibleBranches = useMemo(() => {
    const q = foldVi(branchQuery.trim());
    const matched = q ? gyms.filter((g) => foldVi(branchName(g)).includes(q)) : gyms;
    if (q || matched.length <= BRANCH_LIST_LIMIT) return matched;
    // Chưa tìm gì: những cái đã chọn trước, rồi bù cho đủ một nắm.
    const chosen = matched.filter((g) => scoped.includes(g.id));
    const rest = matched.filter((g) => !scoped.includes(g.id));
    return [...chosen, ...rest].slice(0, Math.max(BRANCH_LIST_LIMIT, chosen.length));
  }, [gyms, branchQuery, scoped]);
  const hiddenBranchCount = gyms.length - visibleBranches.length;
  const loading = accountsQuery.isLoading || invitesQuery.isLoading;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-owner/dashboard"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Người quản lý" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={accountsQuery.isRefetching}
            onRefresh={() => {
              void accountsQuery.refetch();
              void invitesQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <Card className="mb-4 flex-row items-start gap-2.5 p-4">
          <Info size={15} color={designTokens.mutedForeground} />
          <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
            Người quản lý vận hành được những chi nhánh bạn gán, nhưng{" "}
            <Text className="font-body-semibold text-foreground">không xem được ví</Text>, không mời thêm người và
            không sửa được thương hiệu.
          </Text>
        </Card>

        <Button full icon={Plus} className="mb-4" disabled={gyms.length === 0} onPress={() => setInviteOpen(true)}>
          Mời người quản lý
        </Button>

        {loading ? (
          <ActivityIndicator className="mt-6" color={accent.primary} />
        ) : managers.length === 0 && invites.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Chưa có người quản lý nào"
            description="Mời một người để họ vận hành chi nhánh giúp bạn."
          />
        ) : (
          <Stagger className="gap-3">
            {managers.map((m) => (
              <StaggerItem key={m.id}>
                <Card className="gap-3 p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                      <UserRound size={18} color={designTokens.mutedForeground} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {managerName(m)}
                      </Text>
                      {m.identity?.email ? (
                        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                          {m.identity.email}
                        </Text>
                      ) : null}
                      <Text className="mt-0.5 font-body text-[11px] text-muted-foreground" numberOfLines={2}>
                        {managerScopeLabel(m, gyms)}
                      </Text>
                    </View>
                    <Badge tone="info">Quản lý</Badge>
                  </View>
                  <Tappable
                    accessibilityLabel={`Thu hồi quyền của ${managerName(m)}`}
                    hitSlop={8}
                    onPress={() => askRevoke(m.id, managerName(m))}
                    className="self-start border-t border-border pt-2"
                  >
                    <Text className="font-body-semibold text-xs text-destructive">Thu hồi quyền</Text>
                  </Tappable>
                </Card>
              </StaggerItem>
            ))}

            {invites.map((inv) => {
              const days = daysSince(inv.createdAt);
              const stale = inviteIsStale(inv);
              return (
                <StaggerItem key={inv.id}>
                  <Card className="gap-3 p-4">
                    <View className="flex-row items-start gap-3">
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {inv.email}
                        </Text>
                        <Text className={`font-body text-[11px] ${stale ? "text-warning" : "text-muted-foreground"}`}>
                          {days == null ? "Đã mời" : days === 0 ? "Đã mời hôm nay" : `Đã mời ${days} ngày trước`}
                          {stale ? " — chưa nhận" : ""}
                        </Text>
                      </View>
                      <Badge tone="warning">Chờ nhận</Badge>
                    </View>
                    <View className="flex-row gap-2 border-t border-border pt-3">
                      <Button
                        className="flex-1"
                        size="sm"
                        variant="secondary"
                        disabled={resend.isPending}
                        onPress={() => resend.mutate(inv.id)}
                      >
                        Gửi lại
                      </Button>
                      <Button
                        className="flex-1"
                        size="sm"
                        variant="destructive"
                        disabled={revokeInvite.isPending}
                        onPress={() => revokeInvite.mutate(inv.id)}
                      >
                        Thu hồi
                      </Button>
                    </View>
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>

      <BottomSheet open={inviteOpen} onClose={() => setInviteOpen(false)} title="Mời người quản lý">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="quanly@example.com"
            placeholderTextColor={inputPlaceholderColor}
          />
          <View className="flex-row items-center justify-between px-1">
            <Text className="font-body text-sm text-muted-foreground">Quản lý chi nhánh nào?</Text>
            <Text className="font-body text-xs text-muted-foreground">
              {scoped.length > 0 ? `Đã chọn ${scoped.length}` : "Chưa chọn"}
            </Text>
          </View>
          {/* Tài khoản thật có 55 chi nhánh: vẽ hết ra thì nút "Gửi lời mời" nằm dưới 55 hàng, phải
              vuốt mãi mới tới. Nên: ô tìm theo tên, và khi chưa gõ gì thì chỉ bày một nắm — những
              chi nhánh ĐÃ CHỌN luôn hiện, để không ai mất dấu lựa chọn của chính mình. */}
          {gyms.length > BRANCH_LIST_LIMIT ? (
            <Input
              icon={Search}
              value={branchQuery}
              onChangeText={setBranchQuery}
              placeholder="Tìm chi nhánh theo tên…"
              placeholderTextColor={inputPlaceholderColor}
            />
          ) : null}
          <Card className="overflow-hidden">
            {visibleBranches.map((g, i) => {
              const on = scoped.includes(g.id);
              return (
                <Tappable
                  key={g.id}
                  accessibilityLabel={branchName(g)}
                  onPress={() => setScoped((prev) => (on ? prev.filter((x) => x !== g.id) : [...prev, g.id]))}
                  className={`flex-row items-center gap-3 p-3.5 ${i > 0 ? "border-t border-border" : ""}`}
                >
                  <View
                    className={`h-5 w-5 items-center justify-center rounded-md border ${on ? "border-primary bg-primary" : "border-border"}`}
                  >
                    {on ? <Check size={13} color={accent.onPrimary} /> : null}
                  </View>
                  <Text className="min-w-0 flex-1 font-body text-sm text-foreground" numberOfLines={1}>
                    {branchName(g)}
                  </Text>
                </Tappable>
              );
            })}
          </Card>
          {hiddenBranchCount > 0 ? (
            <Text className="px-1 font-body text-[11px] text-muted-foreground">
              Còn {hiddenBranchCount} chi nhánh nữa — gõ tên để tìm.
            </Text>
          ) : null}
          <Button disabled={!!error || invite.isPending} onPress={() => invite.mutate()}>
            {invite.isPending ? "Đang gửi…" : "Gửi lời mời"}
          </Button>
          {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
        </ScrollView>
      </BottomSheet>

      {/* Email có thể không gửi được — liên kết phải sao chép được, nếu không người được mời kẹt. */}
      <BottomSheet open={!!created} onClose={() => setCreated(null)} title="Đã tạo lời mời">
        <View className="gap-3">
          <Text className="font-body text-sm text-foreground">Lời mời tới {created?.email}</Text>
          <Text className="font-body text-xs text-muted-foreground">
            {created?.emailSent
              ? "Email đã được gửi. Bạn vẫn có thể gửi liên kết dưới đây cho họ."
              : "Không gửi được email tự động — hãy sao chép liên kết dưới đây và gửi cho họ."}
          </Text>
          <View className="rounded-xl border border-border bg-panel p-3">
            <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={3}>
              {created?.inviteLink || "Máy chủ không trả về liên kết."}
            </Text>
          </View>
          <Button
            icon={Copy}
            disabled={!created?.inviteLink}
            onPress={async () => {
              if (!created?.inviteLink) return;
              await Clipboard.setStringAsync(created.inviteLink);
              toast.show("Đã sao chép liên kết", "success");
            }}
          >
            Sao chép liên kết
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}
