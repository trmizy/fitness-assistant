import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, ShieldCheck, X } from "lucide-react-native";

import { Badge, Button, Card, EmptyState, ScreenHeader, Segmented, useToast } from "../../../src/components/ui";
import { gymService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { designTokens } from "../../../src/theme/colors";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { Chip, FieldLabel, TextArea } from "../../../src/features/plans/PlanWidgets";

// Web's ReportIssueDialog labels (gym-service ComplaintIssueType / ComplaintStatus).
const ISSUE_TYPES: { value: string; label: string }[] = [
  { value: "CLEANLINESS", label: "Vệ sinh" },
  { value: "STAFF_BEHAVIOR", label: "Thái độ nhân viên" },
  { value: "EQUIPMENT_CONDITION", label: "Thiết bị hư hỏng" },
  { value: "FALSE_ADVERTISING", label: "Quảng cáo sai sự thật" },
  { value: "BILLING", label: "Tính phí sai" },
  { value: "SAFETY", label: "An toàn" },
  { value: "OTHER", label: "Khác" },
];
const STATUS: Record<string, { label: string; tone: "info" | "warning" | "success" }> = {
  OPEN: { label: "Mới gửi", tone: "info" },
  IN_PROGRESS: { label: "Đang xử lý", tone: "warning" },
  RESOLVED: { label: "Đã xử lý", tone: "success" },
};
const MAX_PHOTOS = 5;
const MODES = ["Gửi phản ánh", "Báo cáo của tôi"];

/**
 * SH-07 — "Báo cáo vấn đề" về một phòng gym (the design's ReportIssue; web's ReportIssueDialog,
 * opened from a membership card). Private: no rating, evidence photos are uploaded as private
 * tokens that only the reporter and admin can fetch. History shows this gym's past reports with
 * the admin's response.
 */
export default function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { gymId, gymName } = useLocalSearchParams<{ gymId: string; gymName?: string }>();
  const id = String(gymId ?? "");
  const [mode, setMode] = useState(MODES[0]);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<{ uri: string; token: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const key = ["my-complaints", user?.id ?? "guest"];

  const history = useQuery({ queryKey: key, queryFn: () => gymService.listMyComplaints(), enabled: mode === MODES[1] });
  const mine: any[] = (Array.isArray(history.data) ? history.data : []).filter((c: any) => c.gymId === id);

  const submit = useMutation({
    mutationFn: () => gymService.submitGymComplaint(id, { issueType: issueType!, description: description.trim(), photoTokens: photos.map((p) => p.token) }),
    onSuccess: () => {
      toast.show("Đã gửi báo cáo — Gymini sẽ xem xét sớm", "success");
      void queryClient.invalidateQueries({ queryKey: key });
      setDescription("");
      setPhotos([]);
      setIssueType(null);
      setMode(MODES[1]);
    },
    onError: (e: any) => toast.show(e?.response?.data?.error?.message || "Không thể gửi báo cáo", "danger"),
  });

  const addPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show("Cần quyền truy cập ảnh.", "danger");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;
    setUploading(true);
    try {
      const { token } = await gymService.uploadComplaintPhoto({ uri: a.uri, name: `bao-cao-${Date.now()}.jpg`, type: "image/jpeg" });
      setPhotos((p) => [...p, { uri: a.uri, token }]);
    } catch (e: any) {
      toast.show(e?.response?.data?.error?.message || "Tải ảnh thất bại", "danger");
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = !!issueType && description.trim().length > 0 && !submit.isPending && !uploading;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Báo cáo vấn đề" onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/services"))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Text className="font-body text-sm text-muted-foreground">{gymName ? String(gymName) : "Phòng gym của bạn"}</Text>
        <Segmented options={MODES} value={mode} onChange={setMode} />

        {mode === MODES[0] ? (
          <>
            <View>
              <FieldLabel>Loại vấn đề</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {ISSUE_TYPES.map((t) => (
                  <Chip key={t.value} label={t.label} active={issueType === t.value} onPress={() => setIssueType(t.value)} />
                ))}
              </View>
            </View>
            <View>
              <FieldLabel>Mô tả</FieldLabel>
              <TextArea value={description} onChangeText={setDescription} placeholder="Mô tả vấn đề bạn gặp: thời gian, khu vực, chi tiết…" rows={5} />
            </View>
            <View>
              <FieldLabel>{`Ảnh minh chứng (${photos.length}/${MAX_PHOTOS})`}</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {photos.map((p, i) => (
                  <View key={p.token} className="h-20 w-20 overflow-hidden rounded-xl">
                    <Image source={{ uri: p.uri }} className="h-full w-full" />
                    <Pressable accessibilityLabel="Bỏ ảnh" onPress={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60">
                      <X size={13} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS ? (
                  <Pressable accessibilityLabel="Thêm ảnh" onPress={() => void addPhoto()} disabled={uploading} className="h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border bg-panel">
                    {uploading ? <ActivityIndicator color={accent.primary} /> : <ImagePlus size={20} color={designTokens.mutedForeground} />}
                  </Pressable>
                ) : null}
              </View>
            </View>
            <View className="flex-row items-start gap-2">
              <ShieldCheck size={15} color={designTokens.mutedForeground} />
              <Text className="flex-1 font-body text-xs text-muted-foreground">Báo cáo chỉ Gymini và bạn xem được — ảnh không bao giờ hiển thị công khai.</Text>
            </View>
            <Button full size="lg" disabled={!canSubmit} onPress={() => submit.mutate()}>
              {submit.isPending ? "Đang gửi…" : "Gửi báo cáo"}
            </Button>
          </>
        ) : history.isLoading ? (
          <ActivityIndicator color={accent.primary} />
        ) : mine.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Chưa có báo cáo nào" description="Các báo cáo bạn gửi về phòng gym này sẽ hiện ở đây." />
        ) : (
          mine.map((c) => {
            const st = STATUS[c.status] ?? { label: c.status, tone: "info" as const };
            return (
              <Card key={c.id} className="gap-2 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="font-body-semibold text-sm text-foreground">{ISSUE_TYPES.find((t) => t.value === c.issueType)?.label ?? "Khác"}</Text>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </View>
                <Text className="font-body text-sm text-muted-foreground">{c.description}</Text>
                <Text className="font-body text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("vi-VN")}</Text>
                {c.adminResponse ? (
                  <View className="rounded-lg bg-panel p-3">
                    <Text className="font-body-semibold text-xs text-foreground">Phản hồi từ Gymini</Text>
                    <Text className="mt-1 font-body text-xs text-muted-foreground">{c.adminResponse}</Text>
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
