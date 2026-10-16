import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";

import { BottomSheet, Button, Input, inputPlaceholderColor, useToast } from "../../components/ui";
import { adminService } from "../../services/api";
import { friendlyError } from "../partnerApplication/partnerApplication";
import {
  COMPLAINT_ISSUE_LABEL,
  COMPLAINT_SOURCE_LABEL,
  complaintNextSteps,
  complaintResponseError,
  type Complaint,
} from "./adminResolve";

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "");

export function ComplaintPhoto({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["admin-complaint-photo", token],
    queryFn: () => adminService.fetchComplaintPhotoFile(token),
    staleTime: Infinity,
  });
  return q.data ? (
    <Image source={{ uri: q.data }} contentFit="cover" style={{ width: 88, height: 88, borderRadius: 10 }} />
  ) : (
    <View className="h-[88px] w-[88px] items-center justify-center rounded-[10px] bg-panel">
      {q.isError ? <Text className="font-body text-[10px] text-muted-foreground">Lỗi ảnh</Text> : <ActivityIndicator />}
    </View>
  );
}

/**
 * One gym complaint: details, evidence photos, and the next status step (Mới → Đang xử lý → Đã xử lý).
 * Shared by the "Xử lý" complaint queue and a partner's "Khiếu nại" tab (14B.8) — web shares one
 * `ComplaintDetailDialog` between the same two places, one table, one vocabulary.
 */
export function ComplaintSheet({
  complaint,
  gymName,
  onClose,
  onUpdated,
}: {
  complaint: Complaint | null;
  gymName?: string;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}) {
  return (
    <BottomSheet open={!!complaint} onClose={onClose} title="Khiếu nại">
      {/* Keyed by id so the reply box starts from THIS complaint's saved response. */}
      {complaint ? <ComplaintBody key={complaint.id} complaint={complaint} gymName={gymName} onClose={onClose} onUpdated={onUpdated} /> : null}
    </BottomSheet>
  );
}

function ComplaintBody({
  complaint,
  gymName,
  onClose,
  onUpdated,
}: {
  complaint: Complaint;
  gymName?: string;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [response, setResponse] = useState(complaint.adminResponse ?? "");

  const update = useMutation({
    mutationFn: (status: "IN_PROGRESS" | "RESOLVED") =>
      adminService.updateComplaintStatus(complaint.id, { status, ...(response.trim() ? { adminResponse: response.trim() } : {}) }),
    onSuccess: async (_r, status) => {
      toast.show(status === "RESOLVED" ? "Đã đóng khiếu nại" : "Đã nhận xử lý", "success");
      onClose();
      await onUpdated();
    },
    onError: (e) => toast.show(friendlyError(e, "Không cập nhật được khiếu nại"), "danger"),
  });

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
      <View className="gap-1">
        <Text className="font-body-semibold text-sm text-foreground">{gymName ?? "Phòng gym"}</Text>
        <Text className="font-body text-xs text-muted-foreground">
          {COMPLAINT_ISSUE_LABEL[complaint.issueType] ?? complaint.issueType} ·{" "}
          {COMPLAINT_SOURCE_LABEL[complaint.source] ?? complaint.source}
        </Text>
      </View>
      <Text className="font-body text-sm leading-5 text-foreground">{complaint.description}</Text>
      {Array.isArray(complaint.photoTokens) && complaint.photoTokens.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {complaint.photoTokens.map((t: string) => (
            <ComplaintPhoto key={t} token={t} />
          ))}
        </ScrollView>
      ) : null}
      {complaintNextSteps(complaint.status).length > 0 ? (
        <>
          <Input
            label="Phản hồi cho đối tác"
            value={response}
            onChangeText={setResponse}
            multiline
            numberOfLines={3}
            placeholder="Kết quả xử lý, yêu cầu khắc phục…"
            placeholderTextColor={inputPlaceholderColor}
          />
          {complaintNextSteps(complaint.status).map((s) => (
            <Button
              key={s.value}
              variant={s.value === "RESOLVED" ? "primary" : "secondary"}
              disabled={!!complaintResponseError(s.value, response) || update.isPending}
              onPress={() => update.mutate(s.value)}
            >
              {s.label}
            </Button>
          ))}
          <Text className="font-body text-[11px] text-muted-foreground">Đã xử lý là điểm cuối — không mở lại được.</Text>
        </>
      ) : (
        <View className="gap-1 rounded-xl bg-panel p-3">
          <Text className="font-body text-xs text-muted-foreground">Xử lý xong lúc {when(complaint.resolvedAt)}</Text>
          {complaint.adminResponse ? <Text className="font-body text-xs text-foreground">{complaint.adminResponse}</Text> : null}
        </View>
      )}
    </ScrollView>
  );
}
