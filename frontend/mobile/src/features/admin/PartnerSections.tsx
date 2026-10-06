import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  KeyRound,
  LogOut,
  MessageSquareWarning,
  Pencil,
  ShieldCheck,
  TriangleAlert,
  UserMinus,
  X,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { adminService } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { friendlyError } from "../partnerApplication/partnerApplication";
import { COMPLAINT_ISSUE_LABEL, COMPLAINT_SOURCE_LABEL, COMPLAINT_STATUS, complaintRows, type Complaint } from "./adminResolve";
import { ComplaintSheet } from "./ComplaintSheet";
import {
  BRANCH_STATUS,
  CONTACT_CHANNELS,
  DOC_TYPE_LABEL,
  MEMBER_POLICIES,
  PARTNER_DOC_STATUS,
  SUSPEND_CONSEQUENCES,
  VERIFICATION_STATUS,
  accountGroups,
  auditLabel,
  channelLabel,
  identityName,
  isOldInvitation,
  legacyEditsBlocked,
  nb,
  partnerForm,
  partnerFormError,
  partnerFormPayload,
  pendingInvitations,
  percentLabel,
  relativeOrAbsolute,
  terminateResultMessage,
  terminationImpact,
  type AdminPartner,
  type Identity,
  type MemberPolicy,
  type PartnerAccount,
  type PartnerForm,
} from "./adminPartners";

/**
 * 14B.8 (PG-D1) — the tabs of web AdminPartnersPage's partner detail, one component per tab, plus the
 * suspend / terminate / view-as sheets. Same endpoints and the same conditions as web; destructive
 * steps (revoke, force sign-out, transfer) get a confirmation here, which web does not ask for.
 */

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—");

function useFail() {
  const toast = useToast();
  return (e: unknown, fallback: string) => toast.show(friendlyError(e, fallback), "danger");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      <Text className="min-w-0 flex-1 text-right font-body text-xs text-foreground" selectable>
        {value}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="min-w-[46%] flex-1 gap-0.5 p-3">
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </Card>
  );
}

// ── Tổng quan ─────────────────────────────────────────────────────────────────────────────

export function OverviewSection({
  partner,
  gyms,
  brand,
  identities,
  onChange,
}: {
  partner: AdminPartner;
  gyms: any[];
  brand: any;
  identities: Identity[];
  onChange: () => void;
}) {
  const owner = (partner.accounts ?? []).find((a) => a.role === "OWNER" && a.status === "ACTIVE");
  const ownerIdentity = identities.find((i) => i.accountId === owner?.id);
  const phone = partner.contactPhone ?? (owner?.contactPhone ? `${owner.contactPhone} (người đại diện)` : "—");
  const ownerName = ownerIdentity ? `${ownerIdentity.firstName ?? ""} ${ownerIdentity.lastName ?? ""}`.trim() || partner.representativeName || "" : "";
  const ownerText = ownerIdentity ? (ownerName ? `${ownerName} (${ownerIdentity.email})` : ownerIdentity.email) : "Chưa có";
  const [editing, setEditing] = useState(false);

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-3">
        <Stat label="Chi nhánh" value={String(gyms.length)} />
        <Stat label="Thương hiệu" value={brand?.name ?? "Chưa đặt tên"} />
        <Stat label="Tài khoản" value={String((partner.accounts ?? []).filter((a) => a.status === "ACTIVE").length)} />
        <Stat label="Chiết khấu riêng" value={percentLabel(partner.commissionRateOverride) ?? "Mức chung"} />
      </View>
      <Card className="gap-2 p-4">
        <Row label="Email liên hệ" value={partner.contactEmail ?? "—"} />
        <Row label="Điện thoại" value={phone} />
        <Row label="Chủ sở hữu" value={ownerText} />
        {partner.expectedBranchCount != null ? <Row label="Số chi nhánh dự kiến" value={String(partner.expectedBranchCount)} /> : null}
        {partner.negotiationNotes ? (
          <View className="gap-1 border-t border-border pt-2">
            <Text className="font-body text-[11px] text-muted-foreground">Ghi chú đàm phán</Text>
            <Text className="font-body text-xs text-foreground">{partner.negotiationNotes}</Text>
          </View>
        ) : null}
      </Card>
      {legacyEditsBlocked(partner) ? (
        <SelfServiceNote partnerId={partner.id} />
      ) : (
        <>
          <VerificationPanel partner={partner} onChange={onChange} />
          <Button variant="secondary" size="sm" icon={Pencil} onPress={() => setEditing(true)}>
            Sửa hồ sơ / điều khoản đã chốt
          </Button>
          <EditPartnerSheet open={editing} partner={partner} onClose={() => setEditing(false)} onSaved={onChange} />
        </>
      )}
    </View>
  );
}

/** A self-registered partner's profile and documents are handled in the application review, not here. */
function SelfServiceNote({ partnerId }: { partnerId: string }) {
  return (
    <Tappable accessibilityLabel="Mở hồ sơ đăng ký" onPress={() => router.push(`/admin/applications/${partnerId}` as never)}>
      <Card className="flex-row items-center gap-3 p-4">
        <ShieldCheck size={16} color={designTokens.mutedForeground} />
        <Text className="min-w-0 flex-1 font-body text-xs leading-5 text-muted-foreground">
          Đối tác tự đăng ký: hồ sơ, giấy tờ và thẩm định được xử lý trong “Duyệt hồ sơ đối tác” (có nhật ký từng bước), không sửa ở đây.
        </Text>
        <ChevronRight size={16} color={designTokens.mutedForeground} />
      </Card>
    </Tappable>
  );
}

/** Web VerificationPanel — only a PROSPECT can still move on the vetting axis. */
function VerificationPanel({ partner, onChange }: { partner: AdminPartner; onChange: () => void }) {
  const toast = useToast();
  const fail = useFail();
  const [notes, setNotes] = useState("");
  const set = useMutation({
    mutationFn: (target: string) => adminService.setPartnerVerificationStatus(partner.id, target, notes.trim() || undefined),
    onSuccess: () => {
      toast.show("Đã cập nhật trạng thái thẩm định", "success");
      setNotes("");
      onChange();
    },
    onError: (e) => fail(e, "Không thể cập nhật"),
  });
  const st = VERIFICATION_STATUS[partner.verificationStatus] ?? { label: partner.verificationStatus, tone: "neutral" as const };
  const canEdit = partner.status === "PROSPECT";
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-1.5">
          <ShieldCheck size={14} color={designTokens.mutedForeground} />
          <Text className="font-body-semibold text-xs text-muted-foreground">Thẩm định hồ sơ</Text>
        </View>
        <Badge tone={st.tone}>{st.label}</Badge>
      </View>
      {partner.verificationNotes ? (
        <Text className="font-body text-xs text-muted-foreground">{`Ghi chú gần nhất: “${partner.verificationNotes}”`}</Text>
      ) : null}
      {canEdit ? (
        <>
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Ghi chú (bắt buộc khi yêu cầu bổ sung)…"
            placeholderTextColor={inputPlaceholderColor}
            multiline
            style={{ height: 64, paddingTop: 10, textAlignVertical: "top" }}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={set.isPending} onPress={() => set.mutate("IN_REVIEW")}>
              Bắt đầu xem xét
            </Button>
            <Button size="sm" variant="secondary" disabled={set.isPending || !notes.trim()} onPress={() => set.mutate("NEEDS_INFO")}>
              Yêu cầu bổ sung
            </Button>
            <Button size="sm" icon={Check} disabled={set.isPending} onPress={() => set.mutate("VERIFIED")}>
              Xác nhận đã thẩm định
            </Button>
          </View>
        </>
      ) : (
        <Text className="font-body text-[11px] text-muted-foreground">Chỉ thay đổi được khi hồ sơ đang ở dạng tiềm năng.</Text>
      )}
    </Card>
  );
}

function EditPartnerSheet({ open, partner, onClose, onSaved }: { open: boolean; partner: AdminPartner; onClose: () => void; onSaved: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Sửa hồ sơ đối tác">
      {open ? <EditPartnerBody partner={partner} onClose={onClose} onSaved={onSaved} /> : null}
    </BottomSheet>
  );
}

function EditPartnerBody({ partner, onClose, onSaved }: { partner: AdminPartner; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const fail = useFail();
  const [form, setForm] = useState<PartnerForm>(() => partnerForm(partner));
  const set = (k: keyof PartnerForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const error = partnerFormError(form);
  const save = useMutation({
    mutationFn: () => adminService.updatePartner(partner.id, partnerFormPayload(form)),
    onSuccess: () => {
      toast.show("Đã lưu", "success");
      onSaved();
      onClose();
    },
    onError: (e) => fail(e, "Không thể lưu"),
  });
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
      <Input label="Tên pháp lý" value={form.legalName} onChangeText={set("legalName")} />
      <Input label="Email liên hệ" value={form.contactEmail} onChangeText={set("contactEmail")} autoCapitalize="none" keyboardType="email-address" />
      <Input label="Điện thoại" value={form.contactPhone} onChangeText={set("contactPhone")} keyboardType="phone-pad" />
      <View className="flex-row gap-2">
        <Input className="flex-1" label="Mã số thuế" value={form.taxCode} onChangeText={set("taxCode")} />
        <Input className="flex-1" label="Số giấy phép KD" value={form.businessLicenseNo} onChangeText={set("businessLicenseNo")} />
      </View>
      <View className="flex-row gap-2">
        <Input
          className="flex-1"
          label="Chiết khấu riêng (%)"
          value={form.commissionPercent}
          onChangeText={set("commissionPercent")}
          keyboardType="decimal-pad"
          placeholder="Bỏ trống = mức chung"
          placeholderTextColor={inputPlaceholderColor}
        />
        <Input className="flex-1" label="Chi nhánh dự kiến" value={form.expectedBranchCount} onChangeText={set("expectedBranchCount")} keyboardType="number-pad" />
      </View>
      <Input
        label="Ghi chú đàm phán"
        value={form.negotiationNotes}
        onChangeText={set("negotiationNotes")}
        multiline
        style={{ height: 72, paddingTop: 10, textAlignVertical: "top" }}
      />
      <Button full disabled={!!error || save.isPending} onPress={() => save.mutate()}>
        {save.isPending ? "Đang lưu…" : "Lưu"}
      </Button>
      {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
    </ScrollView>
  );
}

// ── Tài khoản ─────────────────────────────────────────────────────────────────────────────

export function AccountsSection({
  partner,
  identities,
  invitations,
  onChange,
}: {
  partner: AdminPartner;
  identities: Identity[];
  invitations: unknown;
  onChange: () => void;
}) {
  const toast = useToast();
  const fail = useFail();
  const [renaming, setRenaming] = useState<{ account: PartnerAccount; first: string; last: string } | null>(null);
  const { active, revoked, canRevoke } = accountGroups(partner.accounts);
  const invites = pendingInvitations(invitations);
  const nameOf = (a: PartnerAccount) => identityName(identities.find((i) => i.accountId === a.id), a.userId);

  const rename = useMutation({
    mutationFn: () => adminService.updateGymOwnerName(renaming!.account.userId, { firstName: renaming!.first.trim(), lastName: renaming!.last.trim() || undefined }),
    onSuccess: () => {
      toast.show("Đã cập nhật tên", "success");
      setRenaming(null);
      onChange();
    },
    onError: (e) => fail(e, "Không thể cập nhật tên"),
  });
  const resetPw = useMutation({
    mutationFn: (accountId: string) => adminService.resetPartnerAccountPassword(accountId),
    onSuccess: async (data: any) => {
      if (data?.resetLink) await Clipboard.setStringAsync(String(data.resetLink));
      toast.show(
        data?.emailSent ? "Đã gửi email đặt lại mật khẩu (đã sao chép liên kết)" : "Không gửi được email — đã sao chép liên kết, hãy gửi thủ công",
        data?.emailSent ? "success" : "danger",
      );
    },
    onError: (e) => fail(e, "Không thể phát hành liên kết"),
  });
  const forceLogout = useMutation({
    mutationFn: (accountId: string) => adminService.forceLogoutPartnerAccount(accountId),
    onSuccess: () => toast.show("Đã buộc đăng xuất", "success"),
    onError: (e) => fail(e, "Không thể thực hiện"),
  });
  const revoke = useMutation({
    mutationFn: (accountId: string) => adminService.revokePartnerAccountAsAdmin(accountId, "Thu hồi bởi quản trị viên"),
    onSuccess: () => {
      toast.show("Đã thu hồi tài khoản", "success");
      onChange();
    },
    onError: (e) => fail(e, "Không thể thu hồi"),
  });
  const transfer = useMutation({
    mutationFn: (toAccountId: string) => adminService.transferPartnerOwnership(partner.id, toAccountId, "Chuyển quyền sở hữu bởi quản trị viên"),
    onSuccess: () => {
      toast.show("Đã chuyển quyền sở hữu", "success");
      onChange();
    },
    onError: (e) => fail(e, "Không thể chuyển quyền"),
  });
  const resendInvite = useMutation({
    mutationFn: (id: string) => adminService.resendPartnerInvitation(partner.id, id),
    onSuccess: async (data: any) => {
      if (data?.inviteLink) await Clipboard.setStringAsync(String(data.inviteLink));
      toast.show("Đã gửi lại thư mời (đã sao chép liên kết)", "success");
      onChange();
    },
    onError: (e) => fail(e, "Không thể gửi lại thư mời"),
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => adminService.revokePartnerInvitation(partner.id, id),
    onSuccess: () => {
      toast.show("Đã thu hồi thư mời", "success");
      onChange();
    },
    onError: (e) => fail(e, "Không thể thu hồi thư mời"),
  });

  const confirm = (title: string, message: string, label: string, run: () => void) =>
    Alert.alert(title, message, [
      { text: "Không", style: "cancel" },
      { text: label, style: "destructive", onPress: run },
    ]);

  return (
    <View className="gap-3">
      {active.map((a) => {
        const identity = identities.find((i) => i.accountId === a.id);
        const name = nameOf(a);
        return (
          <Card key={a.id} className="gap-3 p-4">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1 gap-0.5">
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Text className="font-body-semibold text-sm text-foreground">{name}</Text>
                  <Badge tone={a.role === "OWNER" ? "info" : "neutral"}>{a.role === "OWNER" ? "Chủ sở hữu" : "Quản lý"}</Badge>
                </View>
                {identity?.email ? <Text className="font-body text-xs text-muted-foreground">{identity.email}</Text> : null}
                {a.role === "MANAGER" ? (
                  <Text className="font-body text-[11px] text-muted-foreground">{`${a.scopedGymIds?.length ?? 0} chi nhánh được gán`}</Text>
                ) : null}
              </View>
              <Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{a.status === "ACTIVE" ? "Hoạt động" : a.status}</Badge>
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={Pencil}
                onPress={() => setRenaming({ account: a, first: identity?.firstName ?? "", last: identity?.lastName ?? "" })}
              >
                Sửa tên
              </Button>
              <Button size="sm" variant="secondary" icon={KeyRound} disabled={resetPw.isPending} onPress={() => resetPw.mutate(a.id)}>
                Đặt lại mật khẩu
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={LogOut}
                onPress={() => confirm("Buộc đăng xuất?", `${name} sẽ bị đăng xuất khỏi mọi thiết bị.`, "Đăng xuất", () => forceLogout.mutate(a.id))}
              >
                Buộc đăng xuất
              </Button>
              {a.role === "MANAGER" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ArrowLeftRight}
                  onPress={() =>
                    confirm("Chuyển quyền sở hữu?", `Chuyển quyền sở hữu sang “${name}”? Chủ hiện tại sẽ trở thành quản lý.`, "Chuyển quyền", () =>
                      transfer.mutate(a.id),
                    )
                  }
                >
                  Chuyển quyền sở hữu
                </Button>
              ) : null}
              {canRevoke(a) ? (
                <Button
                  size="sm"
                  variant="destructive"
                  icon={UserMinus}
                  onPress={() => confirm("Thu hồi tài khoản?", `${name} sẽ mất quyền truy cập ngay.`, "Thu hồi", () => revoke.mutate(a.id))}
                >
                  Thu hồi
                </Button>
              ) : null}
            </View>
          </Card>
        );
      })}

      {invites.length > 0 ? (
        <View className="gap-2">
          <Text className="font-body-semibold text-xs uppercase text-muted-foreground">Thư mời đang chờ</Text>
          {invites.map((inv) => {
            const old = isOldInvitation(inv.createdAt);
            return (
              <Card key={inv.id} className="gap-2 p-3">
                <Text className="font-body text-xs text-foreground">{`${inv.email} · ${inv.role === "OWNER" ? "Chủ sở hữu" : "Quản lý"}`}</Text>
                <Text className={`font-body text-[11px] ${old ? "text-warning" : "text-muted-foreground"}`}>
                  {`Mời ${relativeOrAbsolute(inv.createdAt)}${old ? " — quá 7 ngày chưa nhận" : ""}`}
                </Text>
                <View className="flex-row gap-2">
                  <Button size="sm" variant="secondary" disabled={resendInvite.isPending} onPress={() => resendInvite.mutate(inv.id)}>
                    Gửi lại
                  </Button>
                  <Button size="sm" variant="destructive" disabled={revokeInvite.isPending} onPress={() => revokeInvite.mutate(inv.id)}>
                    Thu hồi
                  </Button>
                </View>
              </Card>
            );
          })}
        </View>
      ) : null}

      {revoked.length > 0 ? (
        <View className="gap-1.5">
          <Text className="font-body-semibold text-xs uppercase text-muted-foreground">Đã thu hồi</Text>
          {revoked.map((a) => (
            <Text key={a.id} className="rounded-lg bg-panel px-3 py-2 font-body text-xs text-muted-foreground">
              {`${identities.find((i) => i.accountId === a.id)?.email ?? a.userId} · thu hồi ${relativeOrAbsolute(a.revokedAt)}`}
            </Text>
          ))}
        </View>
      ) : null}

      <BottomSheet open={!!renaming} onClose={() => setRenaming(null)} title="Sửa tên tài khoản">
        {renaming ? (
          <View className="gap-3 pb-2">
            <View className="flex-row gap-2">
              <Input className="flex-1" label="Họ" value={renaming.first} onChangeText={(v) => setRenaming((r) => r && { ...r, first: v })} />
              <Input className="flex-1" label="Tên" value={renaming.last} onChangeText={(v) => setRenaming((r) => r && { ...r, last: v })} />
            </View>
            <Text className="font-body text-[11px] text-muted-foreground">Email không sửa được ở đây.</Text>
            <Button full disabled={!renaming.first.trim() || rename.isPending} onPress={() => rename.mutate()}>
              {rename.isPending ? "Đang lưu…" : "Lưu"}
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

// ── Chi nhánh ─────────────────────────────────────────────────────────────────────────────

export function GymsSection({ gyms }: { gyms: any[] }) {
  if (gyms.length === 0) return <EmptyState title="Chủ sở hữu chưa tạo chi nhánh nào" />;
  return (
    <View className="gap-2.5">
      {gyms.map((g) => {
        const st = BRANCH_STATUS[g.status] ?? { label: g.status, tone: "neutral" as const };
        return (
          <Tappable key={g.id} accessibilityLabel={g.approvedName ?? g.name} onPress={() => router.push(`/admin/gyms/${g.id}`)}>
            <Card className="flex-row items-center gap-3 p-4">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                  {g.approvedName ?? g.name}
                </Text>
                <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
                  {[g.approvedAddress ?? g.address, g.city].filter(Boolean).join(", ")}
                </Text>
              </View>
              <Badge tone={st.tone}>{st.label}</Badge>
              <ChevronRight size={16} color={designTokens.mutedForeground} />
            </Card>
          </Tappable>
        );
      })}
    </View>
  );
}

// ── Giấy tờ + nhật ký trao đổi ────────────────────────────────────────────────────────────

export function DocumentsSection({ partnerId, blocked }: { partnerId: string; blocked: boolean }) {
  const toast = useToast();
  const fail = useFail();
  const accent = useWorkspaceAccent();
  const qc = useQueryClient();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const docs = useQuery({ queryKey: ["admin-partner-documents", partnerId], queryFn: () => adminService.listPartnerDocuments(partnerId) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-partner-documents", partnerId] });
  const upsert = useMutation({
    mutationFn: ({ docType, fileUrl }: { docType: string; fileUrl: string }) => adminService.upsertPartnerDocument(partnerId, docType, fileUrl),
    onSuccess: (_d, v) => {
      toast.show("Đã ghi nhận tệp", "success");
      setUrls((u) => ({ ...u, [v.docType]: "" }));
      void invalidate();
    },
    onError: (e) => fail(e, "Không thể ghi nhận"),
  });
  const verify = useMutation({
    mutationFn: ({ docType, decision }: { docType: string; decision: "VERIFIED" | "REJECTED" }) => adminService.verifyPartnerDocument(partnerId, docType, decision),
    onSuccess: () => {
      toast.show("Đã cập nhật", "success");
      void invalidate();
    },
    onError: (e) => fail(e, "Không thể cập nhật"),
  });

  if (docs.isLoading) return <ActivityIndicator color={accent.primary} />;
  const rows: any[] = Array.isArray(docs.data) ? docs.data : [];

  return (
    <View className="gap-2.5">
      {blocked ? <SelfServiceNote partnerId={partnerId} /> : null}
      {rows.map((doc) => {
        const meta = DOC_TYPE_LABEL[doc.docType] ?? { label: doc.docType, required: false };
        const st = PARTNER_DOC_STATUS[doc.status] ?? { label: doc.status, tone: "neutral" as const };
        const url = urls[doc.docType] ?? "";
        return (
          <Card key={doc.docType} className="gap-2.5 p-4">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="font-body-semibold text-sm text-foreground">{meta.label}</Text>
                <Text className="font-body text-[11px] text-muted-foreground">{meta.required ? "Bắt buộc" : "Không bắt buộc"}</Text>
              </View>
              <Badge tone={st.tone}>{st.label}</Badge>
            </View>
            {doc.fileUrl ? (
              <Tappable accessibilityLabel="Mở tệp" onPress={() => void WebBrowser.openBrowserAsync(String(doc.fileUrl))}>
                <Text className="font-body text-[11px] text-primary" numberOfLines={2}>
                  {doc.fileUrl}
                </Text>
              </Tappable>
            ) : doc.fileKey ? (
              // Self-registered partners upload into private storage; the file is read from the
              // application review (each view is audit-logged there), not from this legacy tab.
              <Text className="font-body text-[11px] text-muted-foreground">Tệp tải lên trong hồ sơ đăng ký — xem ở “Duyệt hồ sơ đối tác”.</Text>
            ) : null}
            {doc.verifiedAt ? <Text className="font-body text-[11px] text-muted-foreground">{`Xác minh lúc ${when(doc.verifiedAt)}`}</Text> : null}
            {blocked ? null : (
            <View className="flex-row items-end gap-2">
              <Input
                className="flex-1"
                value={url}
                onChangeText={(v) => setUrls((u) => ({ ...u, [doc.docType]: v }))}
                placeholder="Dán URL tệp đã tải lên…"
                placeholderTextColor={inputPlaceholderColor}
                autoCapitalize="none"
              />
              <Button size="sm" variant="secondary" disabled={!url.trim() || upsert.isPending} onPress={() => upsert.mutate({ docType: doc.docType, fileUrl: url.trim() })}>
                Ghi nhận
              </Button>
            </View>
            )}
            {!blocked && doc.fileUrl && doc.status !== "VERIFIED" ? (
              <View className="flex-row gap-2">
                <Button size="sm" icon={Check} disabled={verify.isPending} onPress={() => verify.mutate({ docType: doc.docType, decision: "VERIFIED" })}>
                  Xác minh
                </Button>
                <Button size="sm" variant="destructive" icon={X} disabled={verify.isPending} onPress={() => verify.mutate({ docType: doc.docType, decision: "REJECTED" })}>
                  Từ chối
                </Button>
              </View>
            ) : null}
          </Card>
        );
      })}
      <ContactLog partnerId={partnerId} />
    </View>
  );
}

function ContactLog({ partnerId }: { partnerId: string }) {
  const fail = useFail();
  const qc = useQueryClient();
  const [channel, setChannel] = useState("CALL");
  const [note, setNote] = useState("");
  const log = useQuery({ queryKey: ["admin-partner-contact-log", partnerId], queryFn: () => adminService.listPartnerContactLog(partnerId) });
  const add = useMutation({
    mutationFn: () => adminService.addPartnerContactLog(partnerId, { channel, note: note.trim() }),
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["admin-partner-contact-log", partnerId] });
    },
    onError: (e) => fail(e, "Không thể ghi"),
  });
  const rows: any[] = Array.isArray(log.data) ? log.data : [];
  return (
    <View className="gap-2 pt-2">
      <Text className="font-body-semibold text-xs uppercase text-muted-foreground">Nhật ký trao đổi</Text>
      <Card className="gap-2.5 p-3">
        <View className="flex-row flex-wrap gap-1.5">
          {CONTACT_CHANNELS.map((c) => {
            const on = c.value === channel;
            return (
              <Tappable
                key={c.value}
                accessibilityLabel={c.label}
                onPress={() => setChannel(c.value)}
                className={`rounded-full border px-3 py-1 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                <Text numberOfLines={1} className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{nb(c.label)}</Text>
              </Tappable>
            );
          })}
        </View>
        <Input
          value={note}
          onChangeText={setNote}
          placeholder="Nội dung trao đổi…"
          placeholderTextColor={inputPlaceholderColor}
          multiline
          style={{ height: 64, paddingTop: 10, textAlignVertical: "top" }}
        />
        <Button size="sm" disabled={!note.trim() || add.isPending} onPress={() => add.mutate()}>
          Ghi lại
        </Button>
      </Card>
      {rows.map((l) => (
        <View key={l.id} className="gap-0.5 rounded-lg bg-panel px-3 py-2">
          <Text className="font-body text-[11px] text-muted-foreground">{`${when(l.occurredAt)} · ${channelLabel(l.channel)}`}</Text>
          <Text className="font-body text-xs text-foreground">{l.note}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Tiền ──────────────────────────────────────────────────────────────────────────────────

export function MoneySection({ partnerId, status }: { partnerId: string; status: string }) {
  const rate = useQuery({ queryKey: ["admin-commission-rate"], queryFn: () => adminService.getCommissionRate() });
  return (
    <View className="gap-3">
      <Card className="gap-1 p-4">
        <Text className="font-body text-xs text-muted-foreground">Mức chiết khấu nền tảng đang áp dụng chung</Text>
        <Text className="font-display text-xl text-foreground">{percentLabel((rate.data as any)?.rate) ?? "—"}</Text>
        <Text className="font-body text-[11px] text-muted-foreground">Chiết khấu riêng cho đối tác này sửa ở tab Tổng quan → “Sửa hồ sơ”.</Text>
      </Card>
      {status === "ACTIVE" || status === "SUSPENDED" ? <ImpactCard partnerId={partnerId} lazy /> : null}
    </View>
  );
}

/** "Xem trước hệ quả nếu chấm dứt" — the same numbers the terminate sheet shows. */
function ImpactCard({ partnerId, lazy }: { partnerId: string; lazy?: boolean }) {
  const accent = useWorkspaceAccent();
  const [show, setShow] = useState(!lazy);
  const q = useQuery({
    queryKey: ["admin-partner-termination-impact", partnerId],
    queryFn: () => adminService.getTerminationImpact(partnerId),
    enabled: show,
  });
  const impact = terminationImpact(q.data);
  if (!show) {
    return (
      <Button variant="secondary" size="sm" icon={TriangleAlert} onPress={() => setShow(true)}>
        Xem trước hệ quả nếu chấm dứt hợp tác
      </Button>
    );
  }
  return (
    <Card className="gap-1.5 p-4">
      {q.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : impact ? (
        <>
          <Row label="Hội viên còn hạn" value={String(impact.activeMembers)} />
          <Row label="Giá trị chưa dùng" value={formatVND(impact.unusedValueTotal)} />
          <Row label="Hợp đồng PT đang chạy" value={String(impact.activePtContracts)} />
          <Row label="Chi nhánh đang hoạt động" value={`${impact.activeGyms}/${impact.totalGyms}`} />
          <Row label="Số dư ví chưa rút" value={formatVND(impact.walletBalanceTotal)} />
        </>
      ) : (
        <Text className="font-body text-xs text-destructive">Không tải được hệ quả.</Text>
      )}
    </Card>
  );
}

// ── Nhật ký kiểm toán ─────────────────────────────────────────────────────────────────────

export function AuditSection({ partnerId }: { partnerId: string }) {
  const accent = useWorkspaceAccent();
  const q = useQuery({ queryKey: ["admin-partner-audit", partnerId], queryFn: () => adminService.getPartnerAuditLog(partnerId) });
  if (q.isLoading) return <ActivityIndicator color={accent.primary} />;
  const rows: any[] = Array.isArray(q.data) ? q.data : [];
  if (rows.length === 0) return <EmptyState title="Chưa có hoạt động nào" />;
  return (
    <View className="gap-2">
      {rows.map((l) => (
        <View key={l.id} className="gap-0.5 rounded-lg bg-panel px-3 py-2.5">
          <Text className="font-body text-[11px] text-muted-foreground">{when(l.createdAt)}</Text>
          <Text className="font-body-semibold text-xs text-foreground">{auditLabel(l.action)}</Text>
          {l.reason ? <Text className="font-body text-xs text-muted-foreground">{`“${l.reason}”`}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ── Ghi chú nội bộ ────────────────────────────────────────────────────────────────────────

export function NotesSection({ partnerId }: { partnerId: string }) {
  const fail = useFail();
  const accent = useWorkspaceAccent();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: ["admin-partner-notes", partnerId], queryFn: () => adminService.listPartnerInternalNotes(partnerId) });
  const add = useMutation({
    mutationFn: () => adminService.addPartnerInternalNote(partnerId, text.trim()),
    onSuccess: () => {
      setText("");
      void qc.invalidateQueries({ queryKey: ["admin-partner-notes", partnerId] });
    },
    onError: (e) => fail(e, "Không thể thêm ghi chú"),
  });
  const rows: any[] = Array.isArray(q.data) ? q.data : [];
  return (
    <View className="gap-3">
      <Text className="font-body text-[11px] text-muted-foreground">Chỉ admin thấy được — chủ sở hữu không bao giờ nhìn thấy mục này.</Text>
      <Input
        value={text}
        onChangeText={setText}
        placeholder="Ví dụ: đã gọi điện, hẹn tuần sau…"
        placeholderTextColor={inputPlaceholderColor}
        multiline
        style={{ height: 64, paddingTop: 10, textAlignVertical: "top" }}
      />
      <Button size="sm" disabled={!text.trim() || add.isPending} onPress={() => add.mutate()}>
        Thêm ghi chú
      </Button>
      {q.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : rows.length === 0 ? (
        <EmptyState title="Chưa có ghi chú nội bộ nào" />
      ) : (
        rows.map((n) => (
          <Card key={n.id} className="gap-1 p-3">
            <Text className="font-body text-xs text-foreground">{n.text}</Text>
            <Text className="font-body text-[11px] text-muted-foreground">{when(n.createdAt)}</Text>
          </Card>
        ))
      )}
    </View>
  );
}

// ── Khiếu nại ─────────────────────────────────────────────────────────────────────────────

export function ComplaintsSection({ partnerId, gyms }: { partnerId: string; gyms: any[] }) {
  const accent = useWorkspaceAccent();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Complaint | null>(null);
  const q = useQuery({ queryKey: ["admin-partner-complaints", partnerId], queryFn: () => adminService.listPartnerComplaints(partnerId) });
  const gymName = new Map(gyms.map((g) => [g.id, g.approvedName ?? g.name]));
  const rows = complaintRows(q.data);
  if (q.isLoading) return <ActivityIndicator color={accent.primary} />;
  return (
    <View className="gap-2">
      {rows.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title="Chưa có khiếu nại nào" />
      ) : (
        rows.map((c) => {
          const st = COMPLAINT_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
          return (
            <Tappable key={c.id} accessibilityLabel="Mở khiếu nại" onPress={() => setSelected(c)}>
              <Card className="gap-1 p-3">
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="min-w-0 flex-1 font-body-semibold text-xs text-foreground" numberOfLines={1}>
                    {`${COMPLAINT_ISSUE_LABEL[c.issueType] ?? c.issueType} · ${COMPLAINT_SOURCE_LABEL[c.source] ?? c.source}`}
                  </Text>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </View>
                <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
                  {c.description}
                </Text>
              </Card>
            </Tappable>
          );
        })
      )}
      <ComplaintSheet
        complaint={selected}
        gymName={selected ? gymName.get(selected.gymId) : undefined}
        onClose={() => setSelected(null)}
        onUpdated={() => qc.invalidateQueries({ queryKey: ["admin-partner-complaints", partnerId] })}
      />
    </View>
  );
}

// ── Sheets: tạm khoá / chấm dứt / xem như đối tác ─────────────────────────────────────────

export function SuspendSheet({ partnerId, open, onClose, onDone }: { partnerId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fail = useFail();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => adminService.suspendPartner(partnerId, reason.trim()),
    onSuccess: () => {
      toast.show("Đã tạm khoá đối tác", "success");
      setReason("");
      onDone();
      onClose();
    },
    onError: (e) => fail(e, "Không thể tạm khoá"),
  });
  return (
    <BottomSheet open={open} onClose={onClose} title="Tạm khoá đối tác?">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        <Card className="gap-1 p-3">
          <Text className="font-body-semibold text-xs text-destructive">Sẽ xảy ra</Text>
          {SUSPEND_CONSEQUENCES.stops.map((t) => (
            <Text key={t} className="font-body text-xs text-muted-foreground">{`✗ ${t}`}</Text>
          ))}
        </Card>
        <Card className="gap-1 p-3">
          <Text className="font-body-semibold text-xs text-primary">Vẫn tiếp tục</Text>
          {SUSPEND_CONSEQUENCES.continues.map((t) => (
            <Text key={t} className="font-body text-xs text-muted-foreground">{`✓ ${t}`}</Text>
          ))}
        </Card>
        <Input
          label="Lý do (bắt buộc)"
          value={reason}
          onChangeText={setReason}
          multiline
          style={{ height: 64, paddingTop: 10, textAlignVertical: "top" }}
        />
        <Button full variant="destructive" disabled={!reason.trim() || m.isPending} onPress={() => m.mutate()}>
          {m.isPending ? "Đang xử lý…" : "Tạm khoá"}
        </Button>
      </ScrollView>
    </BottomSheet>
  );
}

export function TerminateSheet({ partnerId, open, onClose, onDone }: { partnerId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fail = useFail();
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<MemberPolicy | null>(null);
  const m = useMutation({
    mutationFn: () => adminService.terminatePartner(partnerId, { reason: reason.trim(), memberPolicy: policy! }),
    onSuccess: (data) => {
      const msg = terminateResultMessage(data);
      toast.show(msg.ok, "success");
      if (msg.failed) toast.show(msg.failed, "danger");
      onDone();
      onClose();
    },
    onError: (e) => fail(e, "Không thể chấm dứt"),
  });
  return (
    <BottomSheet open={open} onClose={onClose} title="Chấm dứt hợp tác?">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        <Text className="font-body-semibold text-xs text-destructive">Không quay lại được.</Text>
        {open ? <ImpactCard partnerId={partnerId} /> : null}
        <Text className="font-body text-xs text-muted-foreground">Chọn cách xử lý hội viên còn hạn:</Text>
        {MEMBER_POLICIES.map((p) => {
          const on = p.value === policy;
          return (
            <Tappable
              key={p.value}
              accessibilityLabel={p.label}
              onPress={() => setPolicy(p.value)}
              className={`rounded-xl border px-3 py-3 ${on ? "border-destructive bg-destructive/10" : "border-border bg-panel"}`}
            >
              <Text className={`font-body text-xs ${on ? "text-foreground" : "text-muted-foreground"}`}>{p.label}</Text>
            </Tappable>
          );
        })}
        <Input
          label="Lý do chấm dứt (bắt buộc)"
          value={reason}
          onChangeText={setReason}
          multiline
          style={{ height: 64, paddingTop: 10, textAlignVertical: "top" }}
        />
        <Button full variant="destructive" disabled={!reason.trim() || !policy || m.isPending} onPress={() => m.mutate()}>
          {m.isPending ? "Đang xử lý…" : "Xác nhận chấm dứt"}
        </Button>
      </ScrollView>
    </BottomSheet>
  );
}

export function ViewAsSheet({ partnerId, open, onClose }: { partnerId: string; open: boolean; onClose: () => void }) {
  const accent = useWorkspaceAccent();
  // Every call writes a VIEWED_AS_PARTNER audit row, so it only runs while the sheet is open.
  const q = useQuery({ queryKey: ["admin-view-as-partner", partnerId], queryFn: () => adminService.viewAsPartner(partnerId), enabled: open, staleTime: 0 });
  const d: any = q.data;
  return (
    <BottomSheet open={open} onClose={onClose} title="Xem dưới góc nhìn đối tác">
      <View className="gap-2 pb-2">
        <Text className="font-body text-[11px] text-muted-foreground">Chỉ đọc. Hành động này đã được ghi vào nhật ký kiểm toán.</Text>
        {q.isLoading ? (
          <ActivityIndicator color={accent.primary} />
        ) : d ? (
          <>
            <Row label="Thương hiệu" value={d.brand?.name ?? "Chưa đặt tên"} />
            <Row label="Số chi nhánh" value={String(d.gyms?.length ?? 0)} />
            {(d.gyms ?? []).map((g: any) => {
              const st = BRANCH_STATUS[g.status] ?? { label: g.status, tone: "neutral" as const };
              return (
                <View key={g.id} className="flex-row items-center justify-between gap-2 rounded-lg bg-panel px-3 py-2">
                  <Text className="min-w-0 flex-1 font-body text-xs text-foreground" numberOfLines={1}>
                    {g.approvedName ?? g.name}
                  </Text>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </View>
              );
            })}
          </>
        ) : (
          <Text className="font-body text-xs text-destructive">Không tải được.</Text>
        )}
      </View>
    </BottomSheet>
  );
}
