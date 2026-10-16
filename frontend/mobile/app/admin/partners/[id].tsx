import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye, MoreVertical, RotateCcw, UserMinus } from "lucide-react-native";

import { Badge, BottomSheet, Button, ScreenHeader, Tappable, useToast } from "../../../src/components/ui";
import { adminService } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { friendlyError } from "../../../src/features/partnerApplication/partnerApplication";
import { legacyEditsBlocked, nb, partnerActions, partnerStatus, type AdminPartner, type Identity } from "../../../src/features/admin/adminPartners";
import {
  AccountsSection,
  AuditSection,
  ComplaintsSection,
  DocumentsSection,
  GymsSection,
  MoneySection,
  NotesSection,
  OverviewSection,
  SuspendSheet,
  TerminateSheet,
  ViewAsSheet,
} from "../../../src/features/admin/PartnerSections";

const TABS = [
  { key: "overview", label: "Tổng quan" },
  { key: "accounts", label: "Tài khoản" },
  { key: "gyms", label: "Chi nhánh" },
  { key: "documents", label: "Giấy tờ" },
  { key: "money", label: "Tiền" },
  { key: "audit", label: "Nhật ký" },
  { key: "notes", label: "Ghi chú nội bộ" },
  { key: "complaints", label: "Khiếu nại" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * 14B.8 (PG-D1) — one partner, as web AdminPartnersPage's PartnerDetail: header with status and the
 * suspension / termination reason, an action menu (view as partner, suspend, lift suspension,
 * terminate — offered by the same status rules as web), and eight tabs. Each tab loads its own data
 * only when opened.
 */
export default function AdminPartnerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // expo-router reuses this screen when only `id` changes (e.g. a deep link to another partner), so key
  // the body by id — otherwise the previous partner's open tab, menu and sheets carry over.
  return <PartnerDetail key={String(id)} id={String(id)} />;
}

function PartnerDetail({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<"suspend" | "terminate" | "viewAs" | null>(null);

  const detail = useQuery({ queryKey: ["admin-partner-detail", id], queryFn: () => adminService.getPartner(String(id)), enabled: !!id });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-partner-detail", id] });
    void qc.invalidateQueries({ queryKey: ["admin-partners"] });
    void qc.invalidateQueries({ queryKey: ["admin-partner-queue"] });
  };
  const unsuspend = useMutation({
    mutationFn: () => adminService.unsuspendPartner(String(id)),
    onSuccess: () => {
      toast.show("Đã bỏ tạm khoá", "success");
      invalidate();
    },
    onError: (e) => toast.show(friendlyError(e, "Không thể thực hiện"), "danger"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/partners" as never));
  const d: any = detail.data;
  const partner: AdminPartner | undefined = d?.partner;
  const gyms: any[] = Array.isArray(d?.gyms) ? d.gyms : [];
  const identities: Identity[] = Array.isArray(d?.identities) ? d.identities : [];
  const actions = partnerActions(partner?.status ?? "");
  const hasActions = actions.viewAs || actions.suspend || actions.unsuspend || actions.terminate;

  const pick = (fn: () => void) => {
    setMenu(false);
    fn();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={partner?.legalName ?? "Đối tác"}
        onBack={back}
        right={
          partner && hasActions ? (
            <Tappable accessibilityLabel="Hành động" hitSlop={8} onPress={() => setMenu(true)} className="h-9 w-9 items-center justify-center rounded-full border border-border bg-panel">
              <MoreVertical size={18} color={designTokens.mutedForeground} />
            </Tappable>
          ) : null
        }
      />
      {detail.isLoading ? (
        <ActivityIndicator className="mt-10" color={accent.primary} />
      ) : !partner ? (
        <View className="items-center gap-3 p-8">
          <Text className="text-center font-body text-sm text-destructive">Không tải được đối tác.</Text>
          <Button variant="secondary" onPress={() => void detail.refetch()}>
            Thử lại
          </Button>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
        >
          <View className="gap-1 px-5 pt-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-display text-lg text-foreground">{partner.legalName}</Text>
              <Badge tone={partnerStatus(partner.status).tone}>{partnerStatus(partner.status).label}</Badge>
            </View>
            <Text className="font-body text-xs text-muted-foreground">
              {`${partner.taxCode ? `MST ${partner.taxCode} · ` : ""}Tạo lúc ${new Date(partner.createdAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}`}
            </Text>
            {partner.suspendedReason ? <Text className="font-body text-xs text-warning">{`Lý do tạm khoá: “${partner.suspendedReason}”`}</Text> : null}
            {partner.terminationReason ? <Text className="font-body text-xs text-destructive">{`Lý do chấm dứt: “${partner.terminationReason}”`}</Text> : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 14 }}>
            {TABS.map((t) => {
              const on = t.key === tab;
              return (
                <Tappable
                  key={t.key}
                  accessibilityLabel={t.label}
                  onPress={() => setTab(t.key)}
                  className={`rounded-full border px-3.5 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
                >
                  <Text numberOfLines={1} className={`font-body-medium text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{nb(t.label)}</Text>
                </Tappable>
              );
            })}
          </ScrollView>

          <View className="px-5">
            {tab === "overview" ? (
              <OverviewSection partner={partner} gyms={gyms} brand={d?.brand} identities={identities} onChange={invalidate} />
            ) : tab === "accounts" ? (
              <AccountsSection partner={partner} identities={identities} invitations={d?.invitations} onChange={invalidate} />
            ) : tab === "gyms" ? (
              <GymsSection gyms={gyms} />
            ) : tab === "documents" ? (
              <DocumentsSection partnerId={partner.id} blocked={legacyEditsBlocked(partner)} />
            ) : tab === "money" ? (
              <MoneySection partnerId={partner.id} status={partner.status} />
            ) : tab === "audit" ? (
              <AuditSection partnerId={partner.id} />
            ) : tab === "notes" ? (
              <NotesSection partnerId={partner.id} />
            ) : (
              <ComplaintsSection partnerId={partner.id} gyms={gyms} />
            )}
          </View>
        </ScrollView>
      )}

      <BottomSheet open={menu} onClose={() => setMenu(false)} title="Hành động">
        <View className="gap-2 pb-2">
          {actions.viewAs ? (
            <Button full variant="secondary" icon={Eye} onPress={() => pick(() => setSheet("viewAs"))}>
              Xem dưới góc nhìn đối tác
            </Button>
          ) : null}
          {actions.suspend ? (
            <Button full variant="secondary" icon={Ban} onPress={() => pick(() => setSheet("suspend"))}>
              Tạm khoá
            </Button>
          ) : null}
          {actions.unsuspend ? (
            <Button
              full
              variant="secondary"
              icon={RotateCcw}
              disabled={unsuspend.isPending}
              onPress={() =>
                pick(() =>
                  Alert.alert("Bỏ tạm khoá?", "Chủ sở hữu sẽ đăng nhập lại được ngay và chi nhánh hiện lại ở trang tìm kiếm.", [
                    { text: "Huỷ", style: "cancel" },
                    { text: "Bỏ tạm khoá", onPress: () => unsuspend.mutate() },
                  ]),
                )
              }
            >
              Bỏ tạm khoá
            </Button>
          ) : null}
          {actions.terminate ? (
            <Button full variant="destructive" icon={UserMinus} onPress={() => pick(() => setSheet("terminate"))}>
              Chấm dứt hợp tác
            </Button>
          ) : null}
        </View>
      </BottomSheet>

      {partner ? (
        <>
          <SuspendSheet partnerId={partner.id} open={sheet === "suspend"} onClose={() => setSheet(null)} onDone={invalidate} />
          <TerminateSheet partnerId={partner.id} open={sheet === "terminate"} onClose={() => setSheet(null)} onDone={invalidate} />
          <ViewAsSheet partnerId={partner.id} open={sheet === "viewAs"} onClose={() => setSheet(null)} />
        </>
      ) : null}
    </View>
  );
}
