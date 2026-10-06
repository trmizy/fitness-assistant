import { useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react-native";

import { Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import type { GymReviewsResponse } from "../../types";
import { canReviewGym } from "./reviewRules";

/**
 * 14B.6 (PG-B2) — web `GymReviewsSection`: the public reviews of one gym, and for someone who has
 * held a membership here (ACTIVE or EXPIRED — the server's NOT_A_MEMBER rule) a form to write,
 * update or delete their own one review. Reviewer identity is shown the way web shows it (the
 * service exposes only the client id).
 */
export function GymReviews({ gymId }: { gymId: string }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const reviewsQuery = useQuery({ queryKey: ["gym-reviews", gymId], queryFn: () => gymService.getGymReviews(gymId) as Promise<GymReviewsResponse> });
  const membershipsQuery = useQuery({ queryKey: ["my-memberships"], queryFn: () => gymService.listMyMemberships() });

  const data = reviewsQuery.data;
  const mine = data?.reviews?.find((r) => r.clientId === user?.id) ?? null;
  const canReview = canReviewGym(membershipsQuery.data, gymId);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (mine && seededFor !== mine.id) {
    setSeededFor(mine.id);
    setRating(mine.rating);
    setComment(mine.comment ?? "");
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["gym-reviews", gymId] });
    void qc.invalidateQueries({ queryKey: ["gym", gymId] });
    void qc.invalidateQueries({ queryKey: ["gyms"] });
  };
  const submit = useMutation({
    mutationFn: () => gymService.submitGymReview(gymId, { rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      toast.show(mine ? "Đã cập nhật đánh giá" : "Cảm ơn bạn đã đánh giá!", "success");
      refresh();
    },
    onError: (e: any) => {
      const err = e?.response?.data?.error;
      toast.show(
        err?.code === "NOT_A_MEMBER" ? "Chỉ hội viên đã mua gói tại phòng gym này mới được đánh giá." : err?.message || "Không gửi được đánh giá",
        "danger",
      );
    },
  });
  const remove = useMutation({
    mutationFn: () => gymService.deleteGymReview(gymId),
    onSuccess: () => {
      toast.show("Đã xoá đánh giá", "success");
      setSeededFor(null);
      setRating(5);
      setComment("");
      refresh();
    },
    onError: () => toast.show("Không xoá được đánh giá", "danger"),
  });

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Text className="font-display text-base text-foreground">Đánh giá</Text>
        {data && data.count > 0 ? (
          <Text className="font-body text-xs text-muted-foreground">{`★ ${data.averageRating.toFixed(1)} · ${data.count} đánh giá`}</Text>
        ) : null}
      </View>

      {!canReview ? (
        <Text className="font-body text-xs text-muted-foreground">
          Chỉ hội viên đã mua gói tại phòng gym này mới được đánh giá. Bạn vẫn xem được các đánh giá bên dưới.
        </Text>
      ) : (
        <View className="gap-2.5 rounded-xl border border-border bg-panel p-3">
          <Text className="font-body text-xs text-muted-foreground">{mine ? "Chỉnh sửa đánh giá của bạn" : "Viết đánh giá"}</Text>
          <View className="flex-row gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Tappable key={n} accessibilityLabel={`${n} sao`} onPress={() => setRating(n)} hitSlop={4} className="p-1">
                <Star size={26} color={n <= rating ? designTokens.warning : designTokens.mutedForeground} fill={n <= rating ? designTokens.warning : "transparent"} />
              </Tappable>
            ))}
          </View>
          <Input
            value={comment}
            onChangeText={setComment}
            placeholder="Cảm nhận của bạn về phòng gym (không bắt buộc)"
            placeholderTextColor={inputPlaceholderColor}
            multiline
            style={{ height: 80, paddingTop: 10, paddingBottom: 10, textAlignVertical: "top" }}
            maxLength={1000}
          />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button full size="sm" disabled={submit.isPending} onPress={() => submit.mutate()}>
                {submit.isPending ? "Đang gửi…" : mine ? "Cập nhật" : "Gửi đánh giá"}
              </Button>
            </View>
            {mine ? (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                disabled={remove.isPending}
                onPress={() =>
                  Alert.alert("Xoá đánh giá?", "Đánh giá của bạn sẽ biến khỏi trang phòng gym.", [
                    { text: "Không", style: "cancel" },
                    { text: "Xoá", style: "destructive", onPress: () => remove.mutate() },
                  ])
                }
              >
                Xoá
              </Button>
            ) : null}
          </View>
        </View>
      )}

      {reviewsQuery.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : (data?.reviews ?? []).length === 0 ? (
        <Text className="font-body text-xs text-muted-foreground">Chưa có đánh giá nào.</Text>
      ) : (
        (data?.reviews ?? []).map((r) => (
          <View key={r.id} className="gap-1 border-t border-border pt-2.5">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-body-semibold text-xs text-foreground">
                {r.clientId === user?.id ? "Bạn" : `Hội viên ${r.clientId.slice(0, 6)}`}
              </Text>
              <Text className="font-body text-[11px] text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("vi-VN")}</Text>
            </View>
            <Text className="font-body text-xs text-warning">{"★".repeat(r.rating) + "☆".repeat(Math.max(0, 5 - r.rating))}</Text>
            {r.comment ? <Text className="font-body text-xs text-foreground">{r.comment}</Text> : null}
          </View>
        ))
      )}
    </Card>
  );
}
