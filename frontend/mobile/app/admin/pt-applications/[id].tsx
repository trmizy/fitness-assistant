import { useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Check, ExternalLink, MessageSquareText, Search, X } from "lucide-react-native";

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
import { API_URL, adminPtApplications } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { formatVND } from "../../../src/utils/currency";
import { friendlyError } from "../../../src/features/partnerApplication/partnerApplication";
import {
  absoluteUrl,
  applicantEmail,
  applicantName,
  availabilityLines,
  ptActions,
  ptAppStatus,
  ptCertificates,
  ptDocuments,
  ptMessageError,
  ptReviewPayload,
  ptWaitingText,
  serviceModeLabel,
  type PtAction,
} from "../../../src/features/admin/adminModeration";

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      <Text className="min-w-0 flex-1 text-right font-body text-xs text-foreground" selectable>
        {value && String(value).trim() ? String(value) : "—"}
      </Text>
    </View>
  );
}

const money = (v: unknown) => (v == null || v === "" ? null : formatVND(Number(v)));
const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : null);

/**
 * AD-02 — một đơn ứng tuyển PT. Hành động chỉ hiện khi hợp lệ với trạng thái (`ptActions`) vì máy chủ
 * không tự chặn. Duyệt đổi vai trò tài khoản ngay — hộp xác nhận nói rõ những gì xảy ra.
 */
export default function AdminPtApplicationDetailScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = String(id ?? "");

  const query = useQuery({ queryKey: ["admin-pt-application", appId], queryFn: () => adminPtApplications.get(appId), enabled: !!appId });
  const a = (query.data ?? null) as Record<string, any> | null;

  const [sheet, setSheet] = useState<null | "REQUEST_INFO" | "REJECT">(null);
  const [message, setMessage] = useState("");

  const review = useMutation({
    mutationFn: (action: PtAction) => adminPtApplications.review(appId, action, ptReviewPayload(action, message)),
    onSuccess: async (_r, action) => {
      toast.show(
        action === "APPROVE"
          ? "Đã duyệt — tài khoản đã thành huấn luyện viên"
          : action === "REJECT"
            ? "Đã từ chối đơn"
            : action === "REQUEST_INFO"
              ? "Đã yêu cầu bổ sung"
              : "Đã chuyển sang đang xem xét",
        "success",
      );
      setSheet(null);
      setMessage("");
      await qc.invalidateQueries({ queryKey: ["admin-pt-application", appId] });
      await qc.invalidateQueries({ queryKey: ["admin-pt-applications"] });
      await qc.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (e) => toast.show(friendlyError(e, "Không thực hiện được"), "danger"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/pt-applications"));

  if (query.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Đơn ứng tuyển" onBack={back} />
        <ActivityIndicator className="mt-10" color={accent.primary} />
      </View>
    );
  }
  if (query.isError || !a) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Đơn ứng tuyển" onBack={back} />
        <View className="items-center gap-3 p-8">
          <Text className="text-center font-body text-sm text-destructive">Không tải được đơn này.</Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Thử lại
          </Button>
        </View>
      </View>
    );
  }

  const app = a as any;
  const st = ptAppStatus(app.status);
  const actions = ptActions(app.status);
  const waiting = ptWaitingText(app.status);
  const docs = ptDocuments(app);
  const images = docs.filter((d) => !/\.pdf(\?|$)/i.test(d.url));
  const files = docs.filter((d) => /\.pdf(\?|$)/i.test(d.url));
  const certs = ptCertificates(app);
  const blocks = availabilityLines(app);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={applicantName(app)} onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 32 }}>
        <Card className="gap-2 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-body text-xs text-muted-foreground" selectable>
              {applicantEmail(app)}
            </Text>
            <Badge tone={st.tone}>{st.label}</Badge>
          </View>
          <Row label="Điện thoại" value={app.phoneNumber} />
          <Row label="Số CCCD" value={app.nationalIdNumber} />
          <Row label="Địa chỉ" value={app.currentAddress} />
          <Row label="Nộp lúc" value={app.submittedAt ? new Date(app.submittedAt).toLocaleString("vi-VN") : null} />
        </Card>

        {app.adminNote || app.rejectionReason ? (
          <Card className="gap-1 p-4">
            <Text className="font-body-semibold text-xs text-foreground">Lời nhắn đã gửi người nộp</Text>
            <Text className="font-body text-xs text-muted-foreground">{app.rejectionReason ?? app.adminNote}</Text>
          </Card>
        ) : null}

        <Card className="gap-2 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Chuyên môn</Text>
          <Row label="Kinh nghiệm" value={app.yearsOfExperience ? `${app.yearsOfExperience} năm` : null} />
          <Row label="Chuyên môn chính" value={list(app.mainSpecialties)} />
          <Row label="Nhóm khách" value={list(app.targetClientGroups)} />
          <Row label="Mục tiêu tập" value={list(app.primaryTrainingGoals)} />
          {app.professionalBio ? <Text className="font-body text-xs leading-5 text-muted-foreground">{app.professionalBio}</Text> : null}
        </Card>

        <Card className="gap-2 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Dịch vụ & giá</Text>
          <Row label="Hình thức" value={serviceModeLabel(app.serviceMode)} />
          <Row label="Giá/buổi trực tuyến" value={money(app.onlinePricePerSession)} />
          <Row label="Giá/buổi trực tiếp" value={money(app.offlinePricePerSession)} />
          <Row label="Gói trực tuyến" value={money(app.onlinePackagePrice)} />
          <Row label="Gói trực tiếp" value={money(app.offlinePackagePrice)} />
          <Row label="Buổi/gói · phút/buổi" value={`${app.sessionsPerPackage ?? "—"} · ${app.sessionDurationMinutes ?? "—"}`} />
          {blocks.length > 0 ? (
            <View className="gap-1 pt-1">
              <Text className="font-body text-xs text-muted-foreground">Lịch rảnh</Text>
              {blocks.map((line, i) => (
                <Text key={i} className="font-body text-xs text-foreground">
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </Card>

        <Card className="gap-3 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Giấy tờ & chứng chỉ</Text>
          {images.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {images.map((d) => (
                <Tappable key={d.url} accessibilityLabel={d.label} onPress={() => void Linking.openURL(absoluteUrl(API_URL, d.url))}>
                  <View className="gap-1">
                    <Image
                      source={{ uri: absoluteUrl(API_URL, d.url) }}
                      contentFit="cover"
                      style={{ width: 120, height: 84, borderRadius: 10, backgroundColor: "#222" }}
                    />
                    <Text className="w-[120px] font-body text-[10px] text-muted-foreground" numberOfLines={1}>
                      {d.label}
                    </Text>
                  </View>
                </Tappable>
              ))}
            </ScrollView>
          ) : (
            <Text className="font-body text-xs text-muted-foreground">Chưa có ảnh giấy tờ.</Text>
          )}
          {files.map((d) => (
            <Tappable
              key={d.url}
              accessibilityLabel={d.label}
              onPress={() => void Linking.openURL(absoluteUrl(API_URL, d.url))}
              className="flex-row items-center gap-2 rounded-lg bg-panel px-3 py-2"
            >
              <ExternalLink size={13} color={accent.primary} />
              <Text className="flex-1 font-body text-xs text-foreground">{d.label}</Text>
            </Tappable>
          ))}
          {certs.map((c, i) => (
            <View key={i} className="flex-row items-center justify-between gap-2">
              <Text className="min-w-0 flex-1 font-body text-xs text-foreground">
                {c.name}
                {c.issuer ? ` · ${c.issuer}` : ""}
              </Text>
              <Badge tone={c.valid ? "neutral" : "danger"}>{c.valid ? "Còn hiệu lực" : "Hết hiệu lực"}</Badge>
            </View>
          ))}
        </Card>

        {waiting ? (
          <Card className="p-4">
            <Text className="font-body text-xs leading-5 text-muted-foreground">{waiting}</Text>
          </Card>
        ) : null}

        {actions.length > 0 ? (
          <View className="gap-2">
            {actions.includes("APPROVE") ? (
              <Button
                icon={Check}
                disabled={review.isPending}
                onPress={() =>
                  Alert.alert(
                    "Duyệt đơn này?",
                    "Tài khoản được chuyển sang huấn luyện viên ngay: hiện trong tìm kiếm, nhận hợp đồng, có mã giới thiệu. Không hoàn tác từ màn này.",
                    [
                      { text: "Không", style: "cancel" },
                      { text: "Duyệt", onPress: () => review.mutate("APPROVE") },
                    ],
                  )
                }
              >
                Duyệt — trở thành huấn luyện viên
              </Button>
            ) : null}
            {actions.includes("UNDER_REVIEW") ? (
              <Button variant="secondary" icon={Search} disabled={review.isPending} onPress={() => review.mutate("UNDER_REVIEW")}>
                Bắt đầu xem xét
              </Button>
            ) : null}
            {actions.includes("REQUEST_INFO") ? (
              <Button
                variant="secondary"
                icon={MessageSquareText}
                onPress={() => {
                  setMessage("");
                  setSheet("REQUEST_INFO");
                }}
              >
                Yêu cầu bổ sung
              </Button>
            ) : null}
            {actions.includes("REJECT") ? (
              <Button
                variant="destructive"
                icon={X}
                onPress={() => {
                  setMessage("");
                  setSheet("REJECT");
                }}
              >
                Từ chối
              </Button>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet === "REJECT" ? "Từ chối đơn" : "Yêu cầu bổ sung"}>
        {sheet ? (
          <View className="gap-3 pb-2">
            <Text className="font-body text-xs leading-5 text-muted-foreground">
              {sheet === "REJECT"
                ? "Người nộp đọc được lý do này. Đơn bị từ chối là điểm cuối."
                : "Người nộp đọc được lời nhắn này, sửa đơn rồi gửi lại."}
            </Text>
            <Input
              label="Lời nhắn cho người nộp"
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={4}
              placeholder={sheet === "REJECT" ? "VD: Chứng chỉ đã hết hiệu lực" : "VD: Ảnh CCCD mặt sau bị mờ, chụp lại giúp"}
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button
              variant={sheet === "REJECT" ? "destructive" : "primary"}
              disabled={!!ptMessageError(sheet, message) || review.isPending}
              onPress={() => review.mutate(sheet)}
            >
              {review.isPending ? "Đang gửi…" : sheet === "REJECT" ? "Xác nhận từ chối" : "Gửi yêu cầu"}
            </Button>
            {ptMessageError(sheet, message) && message.length > 0 ? (
              <Text className="font-body text-xs text-muted-foreground">{ptMessageError(sheet, message)}</Text>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
