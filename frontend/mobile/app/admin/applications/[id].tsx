import { useState } from "react";
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FileText, ShieldCheck, TriangleAlert, X } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  Input,
  ScreenHeader,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../../src/components/ui";
import { SelectField } from "../../../src/components/SelectSheet";
import { adminPartnerApplications, type PartnerDocType } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { docStatus, DOC_TYPES, issueStatus, ISSUE_CATEGORY, friendlyError } from "../../../src/features/partnerApplication/partnerApplication";
import {
  EMPTY_CHANGE_REQUEST,
  REVIEW_CATEGORIES,
  adminDocuments,
  adminIssues,
  applicationTitle,
  approveBlockers,
  canApprove,
  changeRequestError,
  changeRequestPayload,
  documentsAwaitingReview,
  rejectError,
  verificationStatus,
  type AdminApplicationDetail,
  canReviewDocument,
  setDocumentNote,
  toggleDocumentRequest,
  type ChangeRequestDraft,
} from "../../../src/features/adminApplications/adminApplications";

/**
 * WB-17 (2/2) — xét một hồ sơ.
 *
 * **Máy chủ quyết định có duyệt được hay không.** `approve.canApprove` và `approve.blockers` đến từ
 * `computeApproveBlockers` của gym-service, kèm sẵn câu tiếng Việt. Màn này hiển thị đúng những câu
 * đó; không dựng lại luật duyệt lần thứ hai, vì hai bộ luật song song sẽ lệch và nút sẽ hứa một thứ
 * máy chủ từ chối.
 *
 * Duyệt là **một transaction** ở máy chủ: bấm đúp hay hai quản trị viên cùng bấm thì người sau nhận
 * 409, không có trạng thái nửa vời.
 *
 * Xem một giấy tờ là mở liên kết ký tạm do máy chủ cấp — **mỗi lần xem đều được ghi nhật ký**, đó là
 * chủ ý của thiết kế chứ không phải phụ phẩm.
 */
export default function AdminApplicationDetailScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const partnerId = String(id ?? "");

  const [sheet, setSheet] = useState<null | "changes" | "reject">(null);
  const [draft, setDraft] = useState<ChangeRequestDraft>(EMPTY_CHANGE_REQUEST);
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const key = ["admin-partner-application", partnerId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => adminPartnerApplications.get(partnerId),
    enabled: !!partnerId,
  });
  const d = (query.data ?? null) as AdminApplicationDetail | null;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ["admin-partner-applications"] });
  };
  const fail = (e: unknown, fallback: string) => toast.show(friendlyError(e, fallback), "danger");

  const acceptDoc = useMutation({
    mutationFn: (docType: PartnerDocType) => adminPartnerApplications.acceptDocument(partnerId, docType),
    onSuccess: async () => {
      toast.show("Đã chấp nhận giấy tờ", "success");
      await refresh();
    },
    onError: (e) => fail(e, "Không chấp nhận được giấy tờ"),
  });

  const openDoc = useMutation({
    mutationFn: async (v: { docType: PartnerDocType; fileId?: string }) =>
      adminPartnerApplications.documentFile(partnerId, v.docType, v.fileId),
    onSuccess: async (res: any) => {
      if (res?.url) await Linking.openURL(String(res.url));
      else toast.show("Máy chủ không trả về liên kết xem tệp", "danger");
    },
    onError: (e) => fail(e, "Không mở được tệp"),
  });

  const requestChanges = useMutation({
    mutationFn: () => adminPartnerApplications.requestChanges(partnerId, changeRequestPayload(draft)),
    onSuccess: async () => {
      toast.show("Đã gửi yêu cầu chỉnh sửa", "success");
      setSheet(null);
      setDraft(EMPTY_CHANGE_REQUEST);
      await refresh();
    },
    onError: (e) => fail(e, "Không gửi được yêu cầu"),
  });

  const resolveIssue = useMutation({
    mutationFn: (issueId: string) => adminPartnerApplications.resolveIssue(partnerId, issueId),
    onSuccess: async () => {
      toast.show("Đã đóng mục góp ý", "success");
      await refresh();
    },
    onError: (e) => fail(e, "Không đóng được mục"),
  });

  const approve = useMutation({
    mutationFn: () => adminPartnerApplications.approve(partnerId),
    onSuccess: async () => {
      toast.show("Đã duyệt hồ sơ", "success");
      await refresh();
    },
    onError: (e) => fail(e, "Không duyệt được hồ sơ"),
  });

  const reject = useMutation({
    mutationFn: () => adminPartnerApplications.reject(partnerId, reason.trim(), adminNote.trim() || undefined),
    onSuccess: async () => {
      toast.show("Đã từ chối hồ sơ", "success");
      setSheet(null);
      await refresh();
    },
    onError: (e) => fail(e, "Không từ chối được hồ sơ"),
  });

  const reopen = useMutation({
    mutationFn: () => adminPartnerApplications.reopen(partnerId),
    onSuccess: async () => {
      toast.show("Đã mở lại hồ sơ cho ứng viên", "success");
      await refresh();
    },
    onError: (e) => fail(e, "Không mở lại được hồ sơ"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/applications"));

  if (query.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Hồ sơ đối tác" onBack={back} />
        <ActivityIndicator className="mt-10" color={accent.primary} />
      </View>
    );
  }

  if (query.isError || !d) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Hồ sơ đối tác" onBack={back} />
        <View className="items-center gap-3 p-8">
          <Text className="text-center font-body text-sm text-destructive">Không tải được hồ sơ này.</Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Thử lại
          </Button>
        </View>
      </View>
    );
  }

  const p: any = d.partner ?? {};
  const st = verificationStatus(p.verificationStatus);
  const v = String(p.verificationStatus ?? "");
  const blockers = approveBlockers(d);
  const docs = adminDocuments(d);
  const issues = adminIssues(d);
  const awaiting = documentsAwaitingReview(d);
  const docLabel = (t: string) => DOC_TYPES.find((x) => x.value === t)?.label ?? t;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={applicationTitle({ id: partnerId, brandName: d.brand?.name, legalName: p.legalName })} onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <Stagger className="gap-4">
          <StaggerItem>
            <Card className="gap-2 p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="font-body-semibold text-sm text-foreground">Trạng thái</Text>
                <Badge tone={st.tone}>{st.label}</Badge>
              </View>
              <Row label="Người đại diện" value={p.representativeName} />
              <Row label="Điện thoại" value={d.representativePhone} />
              <Row label="Email liên hệ" value={p.contactEmail} />
              <Row label="Tên pháp lý" value={p.legalName} />
              <Row label="Mã số thuế" value={p.taxCode} />
              <Row label="Thương hiệu" value={d.brand?.name} />
              <Row label="Chi nhánh đầu" value={d.branch?.name} />
              <Row label="Địa chỉ" value={d.branch?.address} />
              <Row label="Ảnh cơ sở" value={`${Array.isArray(d.photos) ? d.photos.length : 0} ảnh`} />
            </Card>
          </StaggerItem>

          {/* Giấy tờ — duyệt từng loại, và Duyệt hồ sơ bị chặn tới khi đủ loại bắt buộc. */}
          <StaggerItem>
            <Text className="mb-2 px-1 font-display text-lg text-foreground">Giấy tờ</Text>
            <Stagger className="gap-3">
              {docs.length === 0 ? (
                <Card className="p-4">
                  <Text className="font-body text-xs text-muted-foreground">Ứng viên chưa nộp giấy tờ nào.</Text>
                </Card>
              ) : (
                docs.map((doc: any) => {
                  const ds = docStatus(doc.status);
                  const files: any[] = Array.isArray(doc.files) ? doc.files : [];
                  return (
                    <Card key={doc.docType} className="gap-3 p-4">
                      <View className="flex-row items-start gap-3">
                        <FileText size={16} color={designTokens.mutedForeground} />
                        <View className="min-w-0 flex-1">
                          <Text className="font-body-semibold text-sm text-foreground">
                            {docLabel(doc.docType)}
                            {doc.required ? " *" : ""}
                          </Text>
                          <Text className="font-body text-[11px] text-muted-foreground">
                            {files.length > 0 ? `${files.length} tệp` : "Chưa có tệp"}
                            {doc.version ? ` · bản ${doc.version}` : ""}
                          </Text>
                        </View>
                        <Badge tone={ds.tone}>{ds.label}</Badge>
                      </View>

                      {doc.reviewNote ? (
                        <Text className="font-body text-xs text-warning">Đã ghi chú: {doc.reviewNote}</Text>
                      ) : null}

                      {files.map((f, i) => (
                        <Tappable
                          key={f.id ?? i}
                          accessibilityLabel={`Xem tệp ${i + 1}`}
                          onPress={() => openDoc.mutate({ docType: doc.docType, fileId: f.id })}
                          className="flex-row items-center gap-2 rounded-xl bg-panel px-3 py-2"
                        >
                          <ExternalLink size={14} color={accent.primary} />
                          <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
                            Xem tệp {i + 1}
                            {f.mimeType ? ` · ${f.mimeType}` : ""}
                          </Text>
                        </Tappable>
                      ))}

                      {canReviewDocument(d, doc) ? (
                        <Button
                          size="sm"
                          icon={Check}
                          disabled={acceptDoc.isPending}
                          onPress={() => acceptDoc.mutate(doc.docType)}
                        >
                          Chấp nhận giấy tờ
                        </Button>
                      ) : null}
                    </Card>
                  );
                })
              )}
            </Stagger>
          </StaggerItem>

          {issues.length > 0 ? (
            <StaggerItem>
              <Text className="mb-2 px-1 font-display text-lg text-foreground">Mục đã yêu cầu sửa</Text>
              <Stagger className="gap-3">
                {issues.map((i: any) => {
                  const is = issueStatus(i.status);
                  return (
                    <Card key={i.id} className="gap-2 p-4">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="font-body-semibold text-xs text-foreground">
                          {ISSUE_CATEGORY[i.category ?? ""] ?? "Khác"}
                        </Text>
                        <Badge tone={is.tone}>{is.label}</Badge>
                      </View>
                      <Text className="font-body text-xs text-muted-foreground">{i.message}</Text>
                      {i.resubmitNote ? (
                        <Text className="font-body text-[11px] text-muted-foreground">
                          Ứng viên ghi: {i.resubmitNote}
                        </Text>
                      ) : null}
                      {i.status !== "RESOLVED" ? (
                        <Button size="sm" variant="secondary" disabled={resolveIssue.isPending} onPress={() => resolveIssue.mutate(i.id)}>
                          Đóng mục này
                        </Button>
                      ) : null}
                    </Card>
                  );
                })}
              </Stagger>
            </StaggerItem>
          ) : null}

          {/*
            Khối quyết định theo trạng thái hồ sơ — giống web (AdminApplicationsPanel). Chỉ IN_REVIEW mới có
            việc cho admin; hiện nút và "chưa duyệt được vì" ở trạng thái khác làm người duyệt tưởng vừa bấm
            hỏng (gặp thật 28/9: duyệt xong, màn hình vẫn liệt kê lý do chưa duyệt được).
          */}
          {v === "VERIFIED" ? (
            <StaggerItem>
              <Card className="gap-1.5 border-primary/30 bg-primary/5 p-4">
                <Text className="font-body-semibold text-sm text-foreground">Hồ sơ đã được phê duyệt</Text>
                <Text className="font-body text-xs text-muted-foreground">
                  Đối tác đang hoạt động và chi nhánh đầu tiên đã được duyệt cùng lúc.
                </Text>
              </Card>
            </StaggerItem>
          ) : null}

          {v === "REJECTED" ? (
            <StaggerItem>
              <Card className="gap-3 border-destructive/30 bg-destructive/5 p-4">
                <Text className="font-body-semibold text-sm text-foreground">Hồ sơ đã bị từ chối</Text>
                {p.rejectionReason ? (
                  <Text className="font-body text-xs text-muted-foreground">Lý do: {p.rejectionReason}</Text>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={reopen.isPending}
                  onPress={() =>
                    Alert.alert("Mở lại hồ sơ?", "Ứng viên sẽ chỉnh sửa và nộp lại được.", [
                      { text: "Không", style: "cancel" },
                      { text: "Mở lại", onPress: () => reopen.mutate() },
                    ])
                  }
                >
                  Mở lại hồ sơ
                </Button>
              </Card>
            </StaggerItem>
          ) : null}

          {v === "NEEDS_INFO" || v === "NOT_VERIFIED" ? (
            <StaggerItem>
              <Card className="p-4">
                <Text className="font-body text-xs leading-5 text-muted-foreground">
                  {v === "NEEDS_INFO"
                    ? "Đang chờ ứng viên chỉnh sửa và gửi lại. Hồ sơ quay về hàng “Chờ duyệt” khi họ gửi."
                    : "Ứng viên chưa gửi hồ sơ."}
                </Text>
              </Card>
            </StaggerItem>
          ) : null}

          {v === "IN_REVIEW" ? (
            <>
            {/* Vì sao chưa duyệt được — nguyên văn của máy chủ, không diễn giải lại. */}
            {blockers.length > 0 ? (
              <StaggerItem>
                <Card className="gap-1.5 border-warning/30 bg-warning/5 p-4">
                  <Text className="font-body-semibold text-xs text-foreground">Chưa duyệt được vì:</Text>
                  {blockers.map((b, i) => (
                    <View key={i} className="flex-row items-start gap-2">
                      <TriangleAlert size={13} color={designTokens.warning} />
                      <Text className="flex-1 font-body text-xs text-muted-foreground">{b}</Text>
                    </View>
                  ))}
                  {awaiting.length > 0 ? (
                    <Text className="mt-1 font-body text-[11px] text-muted-foreground">
                      Còn {awaiting.length} giấy tờ đã nộp nhưng chưa được chấp nhận.
                    </Text>
                  ) : null}
                </Card>
              </StaggerItem>
            ) : null}

            <StaggerItem>
              <View className="gap-2">
                <Button
                  icon={ShieldCheck}
                  disabled={!canApprove(d) || approve.isPending}
                  onPress={() =>
                    Alert.alert(
                      "Duyệt hồ sơ?",
                      "Đối tác sẽ được kích hoạt và chi nhánh đầu tiên được duyệt cùng lúc. Không hoàn tác được.",
                      [
                        { text: "Không", style: "cancel" },
                        { text: "Duyệt", onPress: () => approve.mutate() },
                      ],
                    )
                  }
                >
                  {approve.isPending ? "Đang duyệt…" : "Duyệt hồ sơ"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={requestChanges.isPending}
                  onPress={() => {
                    setDraft(EMPTY_CHANGE_REQUEST);
                    setSheet("changes");
                  }}
                >
                  Yêu cầu chỉnh sửa
                </Button>
                <Button variant="destructive" icon={X} onPress={() => setSheet("reject")}>
                  Từ chối hồ sơ
                </Button>
              </View>
            </StaggerItem>
            </>
          ) : null}
        </Stagger>
      </ScrollView>

      <BottomSheet open={sheet === "changes"} onClose={() => setSheet(null)} title="Yêu cầu chỉnh sửa">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            Ứng viên đọc đúng câu bạn viết. Nộp lại không tự đóng mục nào — chỉ bạn đóng được.
          </Text>
          <SelectField
            label="Thuộc mục nào"
            value={draft.category}
            options={REVIEW_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            onChange={(v) => setDraft({ ...draft, category: v })}
          />
          <Input
            label="Cần sửa gì"
            value={draft.message}
            onChangeText={(v) => setDraft({ ...draft, message: v })}
            multiline
            numberOfLines={4}
            placeholder="Ví dụ: ảnh giấy phép bị mờ ở phần số đăng ký, cần chụp lại rõ hơn"
            placeholderTextColor={inputPlaceholderColor}
          />
          {/* Giấy tờ đã nộp mà chưa chấp nhận: đánh dấu "Cần cập nhật" kèm lý do — ứng viên thấy đúng
              giấy tờ đó và phải thay tệp. Không có chỗ này thì một giấy tờ sai chỉ còn đường chấp nhận. */}
          {awaiting.length > 0 ? (
            <View className="gap-2">
              <Text className="px-1 font-body text-sm text-muted-foreground">Giấy tờ cần nộp lại (tuỳ chọn)</Text>
              {awaiting.map((doc: any) => {
                const picked = draft.documents.find((x) => x.docType === doc.docType);
                return (
                  <View key={doc.docType} className="gap-2 rounded-xl border border-border bg-panel p-3">
                    <Tappable
                      accessibilityLabel={`Yêu cầu cập nhật ${docLabel(doc.docType)}`}
                      hitSlop={6}
                      onPress={() => setDraft(toggleDocumentRequest(draft, doc.docType))}
                      className="flex-row items-center gap-3"
                    >
                      <View className={`h-5 w-5 items-center justify-center rounded-md border ${picked ? "border-primary bg-primary" : "border-border"}`}>
                        {picked ? <Check size={13} color={accent.onPrimary} /> : null}
                      </View>
                      <Text className="flex-1 font-body text-sm text-foreground">{docLabel(doc.docType)}</Text>
                    </Tappable>
                    {picked ? (
                      <Input
                        value={picked.note}
                        onChangeText={(v) => setDraft(setDocumentNote(draft, doc.docType, v))}
                        placeholder="Vì sao cần nộp lại?"
                        placeholderTextColor={inputPlaceholderColor}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          <Button disabled={!!changeRequestError(draft) || requestChanges.isPending} onPress={() => requestChanges.mutate()}>
            {requestChanges.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
          {changeRequestError(draft) ? (
            <Text className="text-center font-body text-xs text-muted-foreground">{changeRequestError(draft)}</Text>
          ) : null}
        </ScrollView>
      </BottomSheet>

      <BottomSheet open={sheet === "reject"} onClose={() => setSheet(null)} title="Từ chối hồ sơ">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            Từ chối là điểm cuối với ứng viên — họ không sửa và nộp lại được, chỉ bạn mở lại được hồ sơ.
          </Text>
          <Input
            label="Lý do (ứng viên đọc được)"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label="Ghi chú nội bộ (tuỳ chọn)"
            value={adminNote}
            onChangeText={setAdminNote}
            multiline
            numberOfLines={2}
            placeholderTextColor={inputPlaceholderColor}
          />
          <Button variant="destructive" disabled={!!rejectError(reason) || reject.isPending} onPress={() => reject.mutate()}>
            {reject.isPending ? "Đang gửi…" : "Từ chối hồ sơ"}
          </Button>
          {rejectError(reason) && reason ? (
            <Text className="text-center font-body text-xs text-muted-foreground">{rejectError(reason)}</Text>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      <Text className="min-w-0 max-w-[62%] text-right font-body text-xs text-foreground">{value}</Text>
    </View>
  );
}
