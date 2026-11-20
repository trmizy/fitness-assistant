import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, Input, Skeleton, useToast } from "../../components/ui";
import { contractService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { planReviewApi } from "./planReviewApi";
import {
  NOTE_MAX,
  clientAction,
  clientStatusLabel,
  newIdempotencyKey,
  planReviewErrorMessage,
  type PlanReviewItem,
} from "./planReview";

/**
 * Client side of Plan Review on mobile: "Gửi PT duyệt" for the CURRENT workout program, the PT's feedback, and re-sending.
 * Server state only (refetched on mount / pull-to-refresh / after every action; `programVersion` is part of the query key so editing
 * the plan refetches and an approval that no longer applies never reads as current). Query keys carry the user id, so an account
 * switch can never show the previous user's reviews. Renders nothing without an ACTIVE PT contract.
 */
export function PlanReviewCard({ programId, programName, programVersion }: { programId: string; programName: string; programVersion?: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const [confirming, setConfirming] = useState(false);
  const [ptUserId, setPtUserId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // One key per confirmed attempt: a double tap / retry re-sends the SAME key, so the server returns the same request.
  const attemptKey = useRef<string>(newIdempotencyKey());

  const reviews = useQuery({
    queryKey: ["plan-reviews", uid, "mine", programId, programVersion ?? null],
    queryFn: () => planReviewApi.mine(programId),
    retry: false,
  });
  const contracts = useQuery({
    queryKey: ["plan-reviews", uid, "active-contracts"],
    queryFn: () => contractService.getByClient("ACTIVE"),
  });

  const pts = useMemo(() => {
    const raw = Array.isArray(contracts.data) ? contracts.data : (contracts.data as any)?.contracts ?? [];
    const seen = new Map<string, { userId: string; name: string }>();
    for (const c of raw as any[]) {
      if (typeof c?.ptUserId !== "string") continue;
      const name = `${c.ptProfile?.firstName ?? ""} ${c.ptProfile?.lastName ?? ""}`.trim() || "PT của bạn";
      seen.set(c.ptUserId, { userId: c.ptUserId, name });
    }
    return [...seen.values()];
  }, [contracts.data]);

  const latest: PlanReviewItem | undefined = reviews.data?.[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plan-reviews", uid] });
  const chosenPt = ptUserId ?? pts[0]?.userId;

  const submit = useMutation({
    mutationFn: () =>
      planReviewApi.submit({
        ptUserId: chosenPt!,
        clientNote: note.trim() || undefined,
        // Bind the send to the plan version the user is looking at: a newer plan => 409 instead of silently sending another one.
        expectedVersion: programVersion,
        idempotencyKey: attemptKey.current,
      }),
    onSuccess: () => {
      toast.show("Đã gửi kế hoạch cho PT.", "success");
      setConfirming(false);
      setNote("");
      attemptKey.current = newIdempotencyKey();
      void refresh();
    },
    onError: (e) => {
      toast.show(planReviewErrorMessage(e), "danger");
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => planReviewApi.cancel(id),
    onSuccess: () => {
      toast.show("Đã huỷ yêu cầu.", "success");
      void refresh();
    },
    onError: (e) => {
      toast.show(planReviewErrorMessage(e), "danger");
      void refresh();
    },
  });

  if (reviews.isLoading || contracts.isLoading) return <Skeleton className="h-16 w-full rounded-2xl" />;
  if (pts.length === 0 && !latest) return null; // no active PT contract => the feature is simply not offered

  const action = clientAction(latest);
  const status = latest ? clientStatusLabel(latest) : null;

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-body-semibold text-sm text-foreground">PT duyệt kế hoạch</Text>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      </View>

      {latest?.effectiveState === "APPROVED_OUTDATED" ? (
        <Text className="font-body text-xs leading-5 text-warning">
          Bạn đã chỉnh sửa kế hoạch sau khi PT duyệt — lần duyệt trước không còn áp dụng cho bản hiện tại. Hãy gửi lại để PT duyệt bản mới.
        </Text>
      ) : null}

      {latest?.decisionNote ? (
        <View className="rounded-xl border border-border p-3">
          <Text className="mb-1 font-body-semibold text-xs text-muted-foreground">Phản hồi của PT</Text>
          <Text className="font-body text-sm leading-5 text-foreground">{latest.decisionNote}</Text>
        </View>
      ) : null}

      {action === "CANCEL" ? (
        <Button variant="secondary" size="sm" disabled={cancel.isPending} onPress={() => cancel.mutate(latest!.id)}>
          {cancel.isPending ? "Đang huỷ..." : "Huỷ yêu cầu"}
        </Button>
      ) : !confirming ? (
        <Button size="sm" onPress={() => setConfirming(true)}>
          {action === "RESUBMIT" ? "Gửi lại cho PT" : "Gửi PT duyệt"}
        </Button>
      ) : (
        <View className="gap-3 rounded-xl border border-border p-3">
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            PT sẽ nhận một bản sao cố định của kế hoạch “{programName}” (ngày tập, bài tập, số hiệp/lần). Chỉ nội dung kế hoạch được chia sẻ — không kèm
            chỉ số InBody, hồ sơ sức khoẻ hay nhật ký tập.
          </Text>
          {pts.length > 1 ? (
            <View className="gap-2">
              {pts.map((p) => (
                <Button key={p.userId} size="sm" variant={chosenPt === p.userId ? "primary" : "secondary"} onPress={() => setPtUserId(p.userId)}>
                  {p.name}
                </Button>
              ))}
            </View>
          ) : (
            <Text className="font-body text-xs text-muted-foreground">Gửi tới: {pts[0]?.name}</Text>
          )}
          <Input value={note} onChangeText={setNote} maxLength={NOTE_MAX} multiline numberOfLines={2} placeholder="Lời nhắn cho PT (không bắt buộc)" />
          <View className="flex-row gap-2">
            <Button size="sm" disabled={submit.isPending || !chosenPt} onPress={() => submit.mutate()}>
              {submit.isPending ? "Đang gửi..." : "Xác nhận gửi"}
            </Button>
            <Button size="sm" variant="ghost" disabled={submit.isPending} onPress={() => setConfirming(false)}>
              Quay lại
            </Button>
          </View>
        </View>
      )}

      {reviews.isError ? <Text className="font-body text-xs text-destructive">{planReviewErrorMessage(reviews.error)}</Text> : null}
    </Card>
  );
}
