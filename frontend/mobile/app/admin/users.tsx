import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Search, TriangleAlert } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { adminService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { friendlyError } from "../../src/features/partnerApplication/partnerApplication";
import {
  ROLE_FILTERS,
  STATUS_FILTERS,
  filterUsers,
  initials,
  isLocked,
  lockConsequences,
  roleLabel,
  userCounts,
  userRows,
  type AdminUserRow,
} from "../../src/features/admin/adminUsers";

function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tappable
            key={o.value}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            className={`rounded-full border px-3 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
          >
            <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{o.label}</Text>
          </Tappable>
        );
      })}
    </ScrollView>
  );
}

/**
 * AD-05 "Người dùng" — danh bạ tài khoản (gateway `GET /admin/users`) với khoá / mở khoá thật.
 *
 * Web có nút "Suspend account" nhưng không gắn hành động nào. Ở đây nút gọi đúng
 * `PATCH /admin/users/:id/disable|enable`, và trước khi gọi, hộp xác nhận kể ĐÚNG hệ quả theo vai trò
 * (`lockConsequences`) — với PT là huỷ + hoàn tiền mọi hợp đồng đang mở, không đảo ngược được. Danh sách
 * phản ánh được trạng thái khoá nhờ sửa GAP-21 ở gateway (28/9).
 *
 * Danh sách dài (200+) nên dùng FlatList, không map trong ScrollView.
 */
export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<AdminUserRow | null>(null);

  const key = ["admin-user-directory"];
  const query = useQuery({ queryKey: key, queryFn: () => adminService.listUserDirectory() });
  const rows = useMemo(() => userRows(query.data), [query.data]);
  const shown = useMemo(() => filterUsers(rows, q, role, status), [rows, q, role, status]);
  const counts = userCounts(rows);

  const toggle = useMutation({
    mutationFn: (u: AdminUserRow) => adminService.setUserActive(u.id, isLocked(u)),
    onSuccess: async (_res, u) => {
      toast.show(isLocked(u) ? "Đã mở khoá tài khoản" : "Đã khoá tài khoản", "success");
      setSelected(null);
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (e) => toast.show(friendlyError(e, "Không đổi được trạng thái tài khoản"), "danger"),
  });

  const confirmToggle = (u: AdminUserRow) => {
    if (isLocked(u)) {
      Alert.alert("Mở khoá tài khoản?", `${u.name} sẽ đăng nhập lại được.`, [
        { text: "Không", style: "cancel" },
        { text: "Mở khoá", onPress: () => toggle.mutate(u) },
      ]);
      return;
    }
    const c = lockConsequences(u);
    Alert.alert(
      `Khoá tài khoản ${u.name}?`,
      [...c.lines, ...(c.irreversible ? ["", c.irreversible] : [])].join("\n"),
      [
        { text: "Không", style: "cancel" },
        { text: "Khoá", style: "destructive", onPress: () => toggle.mutate(u) },
      ],
    );
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/dashboard"));

  const header = (
    <View className="gap-3 pb-3 pt-4">
      <View className="px-5">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Tìm theo tên hoặc email"
          placeholderTextColor={inputPlaceholderColor}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <Chips options={ROLE_FILTERS} value={role} onChange={setRole} />
      <Chips options={STATUS_FILTERS} value={status} onChange={setStatus} />
      <Text className="px-5 font-body text-xs text-muted-foreground">
        {shown.length === rows.length ? `${rows.length} tài khoản` : `${shown.length} / ${rows.length} tài khoản`}
        {counts.locked > 0 ? ` · ${counts.locked} đang bị khoá` : ""}
      </Text>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Người dùng" onBack={back} />
      {query.isLoading ? (
        <ActivityIndicator className="mt-10" color={accent.primary} />
      ) : query.isError ? (
        <View className="items-center gap-3 p-8">
          <Text className="text-center font-body text-sm text-destructive">Không tải được danh sách người dùng.</Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Thử lại
          </Button>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(u) => u.id}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={accent.primary}
              colors={[accent.primary]}
            />
          }
          ListEmptyComponent={<EmptyState icon={Search} title="Không có tài khoản nào khớp" description="Thử bỏ bớt bộ lọc." />}
          renderItem={({ item: u }) => (
            <Tappable accessibilityLabel={u.name} onPress={() => setSelected(u)} className="mx-5 mb-2">
              <Card className="flex-row items-center gap-3 p-3.5">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                  <Text className="font-body-semibold text-xs text-primary">{initials(u.name)}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                    {u.name}
                  </Text>
                  <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                    {u.email}
                  </Text>
                </View>
                <View className="items-end gap-1">
                  <Badge tone="neutral">{roleLabel(u.role)}</Badge>
                  {isLocked(u) ? <Badge tone="danger">Đã khoá</Badge> : null}
                </View>
              </Card>
            </Tappable>
          )}
        />
      )}

      <BottomSheet open={!!selected} onClose={() => setSelected(null)} title="Tài khoản">
        {selected ? (
          <View className="gap-4 pb-2">
            <View className="items-center gap-1">
              <View className="mb-1 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
                <Text className="font-display text-lg text-primary">{initials(selected.name)}</Text>
              </View>
              <Text className="font-display text-base text-foreground">{selected.name}</Text>
              <Text className="font-body text-xs text-muted-foreground" selectable>
                {selected.email}
              </Text>
              <View className="mt-1 flex-row gap-1.5">
                <Badge tone="neutral">{roleLabel(selected.role)}</Badge>
                <Badge tone={isLocked(selected) ? "danger" : "success"}>{isLocked(selected) ? "Đã khoá" : "Đang hoạt động"}</Badge>
              </View>
            </View>

            <Card className="gap-2 p-4">
              {[
                { label: "Tham gia", value: selected.joined ?? "—" },
                { label: "Cập nhật gần nhất", value: selected.lastActive ?? "—" },
                { label: "Hợp đồng", value: String(selected.contracts ?? 0) },
              ].map((r) => (
                <View key={r.label} className="flex-row justify-between">
                  <Text className="font-body text-xs text-muted-foreground">{r.label}</Text>
                  <Text className="font-body-semibold text-xs text-foreground">{r.value}</Text>
                </View>
              ))}
            </Card>

            {!isLocked(selected) && lockConsequences(selected).irreversible ? (
              <View className="flex-row gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                <TriangleAlert size={14} color={designTokens.warning} />
                <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
                  Khoá huấn luyện viên sẽ huỷ và hoàn tiền mọi hợp đồng đang mở. Không khôi phục được khi mở khoá.
                </Text>
              </View>
            ) : null}

            <Button
              variant={isLocked(selected) ? "secondary" : "destructive"}
              icon={isLocked(selected) ? LockOpen : Lock}
              disabled={toggle.isPending}
              onPress={() => confirmToggle(selected)}
            >
              {toggle.isPending ? "Đang cập nhật…" : isLocked(selected) ? "Mở khoá tài khoản" : "Khoá tài khoản"}
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
