import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MapPin, NotebookPen, Pencil, TriangleAlert, X } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  Input,
  ScreenHeader,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../../src/components/ui";
import { adminService, gymPhotoUrl } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { friendlyError } from "../../../src/features/partnerApplication/partnerApplication";
import { branchStatus, operationalStatus } from "../../../src/features/gymOwner/gymOwner";
import { facilityLabels } from "../../../src/features/services/gymDirectory";
import { GymPhotoGallery } from "../../../src/features/services/GymPhotoGallery";
import {
  BRANCH_DOC_LABEL,
  BRANCH_REVIEW_CATEGORIES,
  DOC_STATUS_LABEL,
  PARTNER_DOC_LABEL,
  approvesBrandToo,
  branchDocuments,
  branchIssuesError,
  branchIssuesPayload,
  displayAddress,
  displayName,
  gymEditError,
  gymEditFormFrom,
  gymEditPayload,
  gymRows,
  hoursDeclared,
  hoursRows,
  isRenameRequest,
  renameNotesError,
  renameNotesPayload,
  toggleBranchIssue,
  type BranchIssueDraft,
  type GymEditForm,
} from "../../../src/features/admin/adminGyms";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-2 p-4">
      <Text className="font-body-semibold text-sm text-foreground">{title}</Text>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      <Text className="min-w-0 flex-1 text-right font-body text-xs text-foreground" selectable>
        {value?.trim() ? value : "—"}
      </Text>
    </View>
  );
}

/**
 * AD-02 — không gian duyệt MỘT chi nhánh (web `BranchReviewDetail` + nút của `AdminGymModeration`).
 *
 * Mọi thứ chủ gym đã khai hiện ở một chỗ để "Duyệt" là quyết định có căn cứ. Hành động theo tình trạng:
 * - `PENDING_REVIEW`: Duyệt / Yêu cầu sửa theo 7 mục (chi nhánh về Nháp, chủ gym sửa rồi gửi lại) /
 *   Từ chối. Máy chủ không nhận lý do từ chối (chỉ `status`) nên hộp xác nhận nói rõ điều đó.
 * - Đang xin đổi tên/địa chỉ: Duyệt tên/địa chỉ mới / Ghi chú yêu cầu sửa (không đổi trạng thái).
 * - Mọi chi nhánh: Sửa thông tin trực tiếp (chỉ gửi trường đã đổi).
 */
export default function AdminGymDetailScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gymId = String(id ?? "");

  const gymsQuery = useQuery({ queryKey: ["admin-gyms-all"], queryFn: () => adminService.listGymsForAdmin() });
  const gym = gymRows(gymsQuery.data).find((g) => g.id === gymId) ?? null;

  const hoursQuery = useQuery({ queryKey: ["admin-gym-hours", gymId], queryFn: () => adminService.getGymHoursForAdmin(gymId), enabled: !!gym });
  const photosQuery = useQuery({ queryKey: ["admin-gym-photos", gymId], queryFn: () => adminService.listGymPhotosForAdmin(gymId), enabled: !!gym });
  const docsQuery = useQuery({ queryKey: ["admin-gym-docs", gymId], queryFn: () => adminService.listBranchDocumentsForAdmin(gymId), enabled: !!gym });

  const [sheet, setSheet] = useState<null | "issues" | "notes" | "edit">(null);
  const [issues, setIssues] = useState<BranchIssueDraft>({});
  const [nameNote, setNameNote] = useState("");
  const [addressNote, setAddressNote] = useState("");
  const [editBefore, setEditBefore] = useState<GymEditForm | null>(null);
  const [edit, setEdit] = useState<GymEditForm | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-gyms-all"] });
    await qc.invalidateQueries({ queryKey: ["admin-brands"] });
  };
  const fail = (e: unknown, fallback: string) => toast.show(friendlyError(e, fallback), "danger");
  const done = async (msg: string) => {
    toast.show(msg, "success");
    setSheet(null);
    await refresh();
  };

  const setStatus = useMutation({
    mutationFn: (status: "APPROVED" | "REJECTED") => adminService.setGymStatus(gymId, status),
    onSuccess: (_r, status) => done(status === "APPROVED" ? "Đã duyệt chi nhánh" : "Đã từ chối chi nhánh"),
    onError: (e) => fail(e, "Không cập nhật được trạng thái chi nhánh"),
  });
  const requestBranchChanges = useMutation({
    mutationFn: () => adminService.requestBranchChanges(gymId, branchIssuesPayload(issues) as any),
    onSuccess: () => done("Đã gửi yêu cầu chỉnh sửa — chi nhánh về trạng thái Nháp"),
    onError: (e) => fail(e, "Không gửi được yêu cầu chỉnh sửa"),
  });
  const approveRename = useMutation({
    mutationFn: () => adminService.approveGymRename(gymId),
    onSuccess: () => done("Đã duyệt tên/địa chỉ mới"),
    onError: (e) => fail(e, "Không duyệt được thay đổi"),
  });
  const requestRenameChanges = useMutation({
    mutationFn: () => adminService.requestGymChanges(gymId, renameNotesPayload(nameNote, addressNote)),
    onSuccess: () => done("Đã gửi ghi chú cho chủ gym"),
    onError: (e) => fail(e, "Không gửi được ghi chú"),
  });
  const saveEdit = useMutation({
    mutationFn: () => adminService.updateGymDetails(gymId, gymEditPayload(editBefore!, edit!)),
    onSuccess: () => done("Đã lưu thông tin chi nhánh"),
    onError: (e) => fail(e, "Không lưu được thông tin"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/gyms"));

  if (gymsQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Chi nhánh" onBack={back} />
        <ActivityIndicator className="mt-10" color={accent.primary} />
      </View>
    );
  }
  if (!gym) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Chi nhánh" onBack={back} />
        <View className="items-center gap-3 p-8">
          <Text className="text-center font-body text-sm text-destructive">Không tìm thấy chi nhánh này.</Text>
          <Button variant="secondary" onPress={() => void gymsQuery.refetch()}>
            Thử lại
          </Button>
        </View>
      </View>
    );
  }

  const st = branchStatus(gym.status);
  const op = gym.status === "APPROVED" ? operationalStatus(gym.operationalStatus) : null;
  const pendingFirst = gym.status === "PENDING_REVIEW";
  const pendingRename = isRenameRequest(gym);
  const photos = (Array.isArray(photosQuery.data) ? photosQuery.data : []).map((p: any) => ({
    id: String(p.id),
    url: gymPhotoUrl(String(p.fileName), p.url ? String(p.url) : null),
    category: p.category ?? null,
  }));
  const docs = branchDocuments(docsQuery.data);
  const facilities = facilityLabels(Array.isArray(gym.facilities) ? gym.facilities : []);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={displayName(gym)} onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 32 }}>
        <Card className="gap-2 p-4">
          <View className="flex-row flex-wrap gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            {op ? <Badge tone={op.tone}>{op.label}</Badge> : null}
          </View>
          <View className="flex-row items-start gap-1.5">
            <MapPin size={13} color={designTokens.mutedForeground} />
            <Text className="flex-1 font-body text-xs text-muted-foreground">{displayAddress(gym)}</Text>
          </View>
          {gym.brand ? <Text className="font-body text-xs text-muted-foreground">Thương hiệu: {gym.brand.name}</Text> : null}
        </Card>

        {pendingFirst && approvesBrandToo(gym) ? (
          <View className="flex-row gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3.5">
            <TriangleAlert size={15} color={designTokens.warning} />
            <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
              Đây là chi nhánh ĐẦU TIÊN của thương hiệu “{gym.brand?.pendingName ?? gym.brand?.name}”. Duyệt chi nhánh này
              cũng duyệt luôn tên thương hiệu hiển thị công khai.
            </Text>
          </View>
        ) : null}

        {pendingRename ? (
          <Section title="Đang xin đổi">
            {gym.pendingName ? (
              <Text className="font-body text-xs text-muted-foreground">
                Tên: {gym.approvedName ?? gym.name} → <Text className="font-body-semibold text-warning">{gym.pendingName}</Text>
              </Text>
            ) : null}
            {gym.pendingAddress ? (
              <Text className="font-body text-xs text-muted-foreground">
                Địa chỉ: {gym.approvedAddress ?? gym.address} →{" "}
                <Text className="font-body-semibold text-warning">{gym.pendingAddress}</Text>
              </Text>
            ) : null}
            {gym.pendingNameNote || gym.pendingAddressNote ? (
              <View className="mt-1 gap-1 rounded-lg bg-panel p-2.5">
                <Text className="font-body text-[11px] text-muted-foreground">Đã yêu cầu sửa:</Text>
                {gym.pendingNameNote ? <Text className="font-body text-xs text-foreground">Tên — {gym.pendingNameNote}</Text> : null}
                {gym.pendingAddressNote ? <Text className="font-body text-xs text-foreground">Địa chỉ — {gym.pendingAddressNote}</Text> : null}
              </View>
            ) : null}
          </Section>
        ) : null}

        <Section title="Thông tin cơ bản">
          <Row label="Tên" value={gym.name} />
          <Row label="Điện thoại" value={gym.phone} />
          <Row label="Email" value={gym.email} />
          {gym.description ? <Text className="font-body text-xs leading-5 text-muted-foreground">{gym.description}</Text> : null}
        </Section>

        <Section title="Địa điểm">
          <Row label="Địa chỉ" value={gym.address} />
          <Row label="Thành phố" value={gym.city} />
          <Row
            label="Toạ độ"
            value={gym.latitude != null && gym.longitude != null ? `${gym.latitude.toFixed(5)}, ${gym.longitude.toFixed(5)}` : "Chưa ghim"}
          />
          {gym.locationNote ? <Row label="Chỉ dẫn" value={gym.locationNote} /> : null}
        </Section>

        <Section title="Giờ hoạt động">
          {hoursQuery.isLoading ? (
            <ActivityIndicator className="self-start" color={accent.primary} />
          ) : !hoursDeclared(hoursQuery.data) ? (
            <Text className="font-body text-xs text-muted-foreground">Chủ gym chưa khai giờ hoạt động.</Text>
          ) : (
            hoursRows(hoursQuery.data).map((h) => <Row key={h.day} label={h.day} value={h.text} />)
          )}
        </Section>

        <Section title="Tiện ích & dịch vụ">
          {facilities.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Chưa khai tiện ích.</Text>
          ) : (
            <View className="flex-row flex-wrap gap-1.5">
              {facilities.map((f) => (
                <Badge key={f} tone="neutral">
                  {f}
                </Badge>
              ))}
            </View>
          )}
        </Section>

        <Section title={`Hình ảnh${photos.length ? ` · ${photos.length}` : ""}`}>
          {photosQuery.isLoading ? (
            <ActivityIndicator className="self-start" color={accent.primary} />
          ) : photos.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Chưa có ảnh.</Text>
          ) : (
            <GymPhotoGallery photos={photos} title={displayName(gym)} />
          )}
        </Section>

        <Section title="Xác minh">
          {docsQuery.isLoading ? (
            <ActivityIndicator className="self-start" color={accent.primary} />
          ) : (
            <>
              {docs.documents.map((d) => {
                const s = DOC_STATUS_LABEL[d.status] ?? { label: d.status, tone: "neutral" as const };
                return (
                  <View key={d.docType} className="flex-row items-center justify-between gap-2">
                    <Text className="min-w-0 flex-1 font-body text-xs text-foreground">
                      {BRANCH_DOC_LABEL[d.docType] ?? d.docType}
                      {d.required ? " *" : ""}
                    </Text>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </View>
                );
              })}
              {docs.partnerContext.length > 0 ? (
                <View className="mt-1 gap-1.5 border-t border-border pt-2">
                  <Text className="font-body text-[11px] text-muted-foreground">Giấy tờ của đối tác (tham khảo)</Text>
                  {docs.partnerContext.map((d) => {
                    const s = DOC_STATUS_LABEL[d.status] ?? { label: d.status, tone: "neutral" as const };
                    return (
                      <View key={d.docType} className="flex-row items-center justify-between gap-2">
                        <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">
                          {PARTNER_DOC_LABEL[d.docType] ?? d.docType}
                        </Text>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </>
          )}
        </Section>

        {pendingFirst ? (
          <View className="gap-2">
            <Button
              icon={Check}
              disabled={setStatus.isPending}
              onPress={() =>
                Alert.alert(
                  "Duyệt chi nhánh?",
                  approvesBrandToo(gym)
                    ? "Chi nhánh hiển thị công khai, và tên thương hiệu cũng được duyệt cùng lúc."
                    : "Chi nhánh sẽ hiển thị công khai và bán được gói hội viên.",
                  [
                    { text: "Không", style: "cancel" },
                    { text: "Duyệt", onPress: () => setStatus.mutate("APPROVED") },
                  ],
                )
              }
            >
              Duyệt chi nhánh
            </Button>
            <Button
              variant="secondary"
              icon={NotebookPen}
              onPress={() => {
                setIssues({});
                setSheet("issues");
              }}
            >
              Yêu cầu chỉnh sửa
            </Button>
            <Button
              variant="destructive"
              icon={X}
              disabled={setStatus.isPending}
              onPress={() =>
                Alert.alert(
                  "Từ chối chi nhánh?",
                  "Máy chủ không lưu lý do từ chối. Nếu chủ gym chỉ cần sửa, hãy dùng “Yêu cầu chỉnh sửa” để họ biết phải sửa gì.",
                  [
                    { text: "Không", style: "cancel" },
                    { text: "Từ chối", style: "destructive", onPress: () => setStatus.mutate("REJECTED") },
                  ],
                )
              }
            >
              Từ chối
            </Button>
          </View>
        ) : null}

        {pendingRename ? (
          <View className="gap-2">
            <Button
              icon={Check}
              disabled={approveRename.isPending}
              onPress={() =>
                Alert.alert("Duyệt thay đổi?", "Tên/địa chỉ mới sẽ hiển thị công khai.", [
                  { text: "Không", style: "cancel" },
                  { text: "Duyệt", onPress: () => approveRename.mutate() },
                ])
              }
            >
              Duyệt tên/địa chỉ mới
            </Button>
            <Button
              variant="secondary"
              icon={NotebookPen}
              onPress={() => {
                setNameNote("");
                setAddressNote("");
                setSheet("notes");
              }}
            >
              Yêu cầu chỉnh sửa
            </Button>
          </View>
        ) : null}

        <Button
          variant="secondary"
          icon={Pencil}
          onPress={() => {
            const f = gymEditFormFrom(gym);
            setEditBefore(f);
            setEdit(f);
            setSheet("edit");
          }}
        >
          Sửa thông tin chi nhánh
        </Button>
      </ScrollView>

      <BottomSheet open={sheet === "issues"} onClose={() => setSheet(null)} title="Yêu cầu chỉnh sửa">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            Chi nhánh về trạng thái Nháp — chủ gym sửa đúng các mục dưới đây rồi gửi lại.
          </Text>
          {BRANCH_REVIEW_CATEGORIES.map((c) => {
            const on = c.value in issues;
            return (
              <View key={c.value} className="gap-2 rounded-xl border border-border bg-panel p-3">
                <Tappable
                  accessibilityLabel={c.label}
                  hitSlop={6}
                  onPress={() => setIssues(toggleBranchIssue(issues, c.value))}
                  className="flex-row items-center gap-3"
                >
                  <View className={`h-5 w-5 items-center justify-center rounded-md border ${on ? "border-primary bg-primary" : "border-border"}`}>
                    {on ? <Check size={13} color={accent.onPrimary} /> : null}
                  </View>
                  <Text className="flex-1 font-body text-sm text-foreground">{c.label}</Text>
                </Tappable>
                {on ? (
                  <Input
                    value={issues[c.value]}
                    onChangeText={(v) => setIssues({ ...issues, [c.value]: v })}
                    placeholder="Cần sửa gì?"
                    placeholderTextColor={inputPlaceholderColor}
                    multiline
                  />
                ) : null}
              </View>
            );
          })}
          <Button disabled={!!branchIssuesError(issues) || requestBranchChanges.isPending} onPress={() => requestBranchChanges.mutate()}>
            {requestBranchChanges.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
          {branchIssuesError(issues) ? (
            <Text className="text-center font-body text-xs text-muted-foreground">{branchIssuesError(issues)}</Text>
          ) : null}
        </ScrollView>
      </BottomSheet>

      <BottomSheet open={sheet === "notes"} onClose={() => setSheet(null)} title="Yêu cầu chỉnh sửa">
        <View className="gap-3 pb-2">
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            Chủ gym thấy ghi chú này bên cạnh tên/địa chỉ đang xin đổi. Chi nhánh vẫn hoạt động bình thường.
          </Text>
          {gym.pendingName ? (
            <Input label="Ghi chú cho tên" value={nameNote} onChangeText={setNameNote} placeholderTextColor={inputPlaceholderColor} />
          ) : null}
          {gym.pendingAddress ? (
            <Input label="Ghi chú cho địa chỉ" value={addressNote} onChangeText={setAddressNote} placeholderTextColor={inputPlaceholderColor} />
          ) : null}
          <Button
            disabled={!!renameNotesError(nameNote, addressNote) || requestRenameChanges.isPending}
            onPress={() => requestRenameChanges.mutate()}
          >
            {requestRenameChanges.isPending ? "Đang gửi…" : "Gửi ghi chú"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={sheet === "edit"} onClose={() => setSheet(null)} title="Sửa thông tin chi nhánh">
        {edit && editBefore ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <Input label="Tên chi nhánh" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
            <Input label="Địa chỉ" value={edit.address} onChangeText={(v) => setEdit({ ...edit, address: v })} />
            <Input label="Thành phố" value={edit.city} onChangeText={(v) => setEdit({ ...edit, city: v })} />
            <Input label="Điện thoại" value={edit.phone} keyboardType="phone-pad" onChangeText={(v) => setEdit({ ...edit, phone: v })} />
            <Input
              label="Email"
              value={edit.email}
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={(v) => setEdit({ ...edit, email: v })}
            />
            <Input label="Mô tả" value={edit.description} multiline onChangeText={(v) => setEdit({ ...edit, description: v })} />
            <Button
              disabled={!!gymEditError(edit) || Object.keys(gymEditPayload(editBefore, edit)).length === 0 || saveEdit.isPending}
              onPress={() => saveEdit.mutate()}
            >
              {saveEdit.isPending ? "Đang lưu…" : "Lưu"}
            </Button>
            {gymEditError(edit) ? <Text className="text-center font-body text-xs text-destructive">{gymEditError(edit)}</Text> : null}
          </ScrollView>
        ) : null}
      </BottomSheet>
    </View>
  );
}
