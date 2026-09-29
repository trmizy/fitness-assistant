import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ChevronDown, ChevronRight, CircleAlert, Gauge, Send, Star, TriangleAlert } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, ScreenHeader, Tappable, useToast } from "../../../../src/components/ui";
import { marketplaceService } from "../../../../src/services/api";
import { useApp } from "../../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { darkColors, designTokens } from "../../../../src/theme/colors";
import { formatVND } from "../../../../src/utils/currency";
import { toDateInputValue } from "../../../../src/utils/date";
import { apiErrorMessage, WEEKDAY_OPTIONS } from "../../../../src/features/plans/aiPlans";
import {
  adoptBlockedReason,
  adoptErrorMessage,
  buildCustomizedSchedule,
  COMPLAINT_TAG_LABEL,
  defaultAdoptWeekdays,
  DIFFICULTY_OPTIONS,
  exerciseKey,
  qualityScoreLabel,
  toggleAdoptWeekday,
  type PreviewDay,
} from "../../../../src/features/plans/marketplace";
import { Chip, FieldLabel, StarInput, StarRow, StartDateStrip, Stepper, TextArea, WeekdayPicker } from "../../../../src/features/plans/PlanWidgets";
import { PtVerifiedBadge } from "../../../../src/features/plans/MarketTab";

/**
 * CL-18 — one published plan on the market (web's PlanMarketplacePage DetailPanel + AdoptPlanModal).
 *
 * "Áp dụng" is the real product action: `POST /marketplace/plans/:id/adopt` copies the plan into
 * the client's own calendar, replacing the active program (unfinished scheduled sessions are
 * cancelled, history kept). A paid listing answers 402 until one of its packages is bought — the
 * sheet says so up front instead of letting the client find out from an error.
 */
export default function ListingDetailScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = String(id ?? "");

  const [showPreview, setShowPreview] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()));
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [customize, setCustomize] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [setsOverride, setSetsOverride] = useState<Record<string, number>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [difficulty, setDifficulty] = useState<"too_easy" | "just_right" | "too_hard" | undefined>();
  const [again, setAgain] = useState<boolean | undefined>();
  const [tags, setTags] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["marketplace", "detail", listingId],
    queryFn: () => marketplaceService.getDetail(listingId),
    enabled: !!listingId,
  });
  const listing = query.data;
  const days = useMemo<PreviewDay[]>(
    () => (listing?.sourcePlan?.plan?.weeklySchedule as PreviewDay[] | undefined) ?? [],
    [listing],
  );
  const daysPerWeek = listing?.sourcePlan?.daysPerWeek ?? 3;
  const selected = weekdays ?? defaultAdoptWeekdays(daysPerWeek);
  const custom = useMemo(() => buildCustomizedSchedule(days, excluded, setsOverride), [days, excluded, setsOverride]);
  const blocked = adoptBlockedReason({ selectedWeekdays: selected, daysPerWeek, confirmedReplace: confirmed, emptyDay: custom.emptyDay });
  const packages = listing?.packages ?? [];
  const q = qualityScoreLabel(listing?.qualityScore);

  const adopt = useMutation({
    mutationFn: () =>
      marketplaceService.adoptPlan(listingId, {
        startDate,
        selectedWeekdays: selected,
        replaceExisting: true,
        customizedWeeklySchedule: custom.customized,
      }),
    onSuccess: () => {
      setAdoptOpen(false);
      toast.show("Đã áp dụng kế hoạch vào lịch tập của bạn", "success");
      void queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
      void queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
      void queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (e) => toast.show(adoptErrorMessage(e), "danger"),
  });

  const review = useMutation({
    mutationFn: () =>
      marketplaceService.submitReview(listingId, rating, comment.trim() || undefined, {
        wouldUseAgain: again,
        difficultyFit: difficulty,
        complaintTags: tags.length > 0 ? tags : undefined,
      }),
    onSuccess: () => {
      toast.show("Đã gửi đánh giá", "success");
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
    // The server only accepts a review after a full cycle on this plan — its message says so.
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể gửi đánh giá"), "danger"),
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Kế hoạch" onBack={() => router.back()} />
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      </View>
    );
  }
  if (!listing) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Kế hoạch" onBack={() => router.back()} />
        <EmptyState icon={CircleAlert} title="Không tải được kế hoạch này" description="Vui lòng thử lại." />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={listing.title} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Card className="p-5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="font-display text-xl text-foreground">{listing.title}</Text>
            {listing.publisherIsVerifiedPt ? <PtVerifiedBadge /> : null}
          </View>
          <Text className="font-body text-sm text-muted-foreground">{listing.goal}</Text>
          <View className="mt-2 flex-row flex-wrap items-center gap-3">
            <View className="flex-row items-center gap-1">
              <Star size={14} color={designTokens.warning} fill={designTokens.warning} />
              <Text className="font-body-semibold text-sm text-foreground">{listing.avgRating.toFixed(1)}</Text>
            </View>
            <Text className="font-body text-xs text-muted-foreground">{`${listing.ratingCount} đánh giá`}</Text>
            {q ? (
              <View className="flex-row items-center gap-1">
                <Gauge size={12} color="#8b9299" />
                <Text className="font-body text-xs text-muted-foreground">{`Chất lượng ${q}`}</Text>
              </View>
            ) : null}
          </View>
          {listing.description ? <Text className="mt-3 font-body text-sm text-muted-foreground">{listing.description}</Text> : null}
          <Text className="mt-2 font-body text-xs text-muted-foreground">
            {[
              listing.version && listing.version > 1 ? `Phiên bản ${listing.version}` : null,
              listing.sourcePlan ? `${listing.sourcePlan.daysPerWeek} buổi/tuần · ${listing.sourcePlan.duration} tuần` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {packages.length > 0 ? (
            <Text className="mt-1 font-body-semibold text-xs text-warning">
              {`Trả phí: ${packages.map((p) => `${p.name} — ${formatVND(p.price)}`).join(", ")}`}
            </Text>
          ) : (
            <Text className="mt-1 font-body-semibold text-xs text-primary">Miễn phí</Text>
          )}
          <View className="mt-4">
            <Button full icon={CalendarPlus} onPress={() => setAdoptOpen(true)}>
              Áp dụng kế hoạch này
            </Button>
          </View>
          {user?.id === listing.publisherId ? (
            <Text className="mt-2 text-center font-body text-[11px] text-muted-foreground">Đây là kế hoạch bạn đã đăng.</Text>
          ) : null}
        </Card>

        <Card className="p-4">
          <Tappable className="flex-row items-center justify-between" onPress={() => setShowPreview((v) => !v)}>
            <Text className="font-body-semibold text-sm text-foreground">{`Xem trước lịch tập (${days.length} buổi)`}</Text>
            {showPreview ? <ChevronDown size={16} color="#8b9299" /> : <ChevronRight size={16} color="#8b9299" />}
          </Tappable>
          {showPreview ? (
            <View className="mt-3 gap-3">
              {days.length === 0 ? (
                <Text className="font-body text-xs text-muted-foreground">Không có dữ liệu xem trước cho kế hoạch này.</Text>
              ) : (
                days.map((d, i) => (
                  <View key={i}>
                    <Text className="font-body-semibold text-xs text-foreground">{`${d.day}${d.goal ? ` — ${d.goal}` : ""}`}</Text>
                    {d.exercises.map((ex, j) => (
                      <Text key={j} className="font-body text-xs text-muted-foreground">{`${ex.name} — ${ex.sets}×${ex.reps}`}</Text>
                    ))}
                    {d.cardio ? <Text className="font-body text-xs italic text-muted-foreground">{`Cardio: ${d.cardio}`}</Text> : null}
                  </View>
                ))
              )}
            </View>
          ) : null}
        </Card>

        <Card className="p-4">
          <Text className="font-display text-base text-foreground">Đánh giá của bạn</Text>
          <Text className="mb-3 mt-1 font-body text-xs text-muted-foreground">
            Bạn cần hoàn thành một chu kỳ tập theo lịch gốc của kế hoạch này trước khi đánh giá.
          </Text>
          <StarInput value={rating} onChange={setRating} />
          <View className="mt-3">
            <TextArea value={comment} onChangeText={setComment} rows={3} placeholder="Nhận xét (không bắt buộc)…" />
          </View>
          <Tappable className="mt-3 flex-row items-center gap-1" onPress={() => setDetailed((v) => !v)}>
            {detailed ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
            <Text className="font-body text-xs text-muted-foreground">Đánh giá chi tiết hơn (không bắt buộc)</Text>
          </Tappable>
          {detailed ? (
            <View className="mt-3 gap-3">
              <View>
                <FieldLabel>Độ khó so với bạn</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {DIFFICULTY_OPTIONS.map((o) => (
                    <Chip key={o.value} label={o.label} active={difficulty === o.value} onPress={() => setDifficulty(o.value)} />
                  ))}
                </View>
              </View>
              <View>
                <FieldLabel>Bạn có muốn dùng lại kế hoạch này không?</FieldLabel>
                <View className="flex-row gap-2">
                  <Chip label="Có" active={again === true} onPress={() => setAgain(true)} />
                  <Chip label="Không" active={again === false} onPress={() => setAgain(false)} />
                </View>
              </View>
              <View>
                <FieldLabel>Vấn đề gặp phải (nếu có)</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {Object.entries(COMPLAINT_TAG_LABEL).map(([tag, label]) => (
                    <Chip
                      key={tag}
                      label={label}
                      active={tags.includes(tag)}
                      onPress={() => setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))}
                    />
                  ))}
                </View>
              </View>
            </View>
          ) : null}
          <View className="mt-4">
            <Button icon={Send} disabled={review.isPending} onPress={() => review.mutate()}>
              {review.isPending ? "Đang gửi…" : "Gửi đánh giá"}
            </Button>
          </View>
        </Card>

        <Text className="px-1 font-display text-base text-foreground">{`Nhận xét (${listing.reviews.length})`}</Text>
        {listing.reviews.length === 0 ? (
          <Text className="px-1 font-body text-sm text-muted-foreground">Chưa có đánh giá nào.</Text>
        ) : (
          listing.reviews.map((r) => (
            <Card key={r.id} className="p-3.5">
              <StarRow value={r.rating} />
              {r.comment ? <Text className="mt-1.5 font-body text-sm text-muted-foreground">{r.comment}</Text> : null}
              {r.wouldUseAgain != null || r.complaintTags?.length ? (
                <View className="mt-1.5 flex-row flex-wrap gap-1">
                  {r.wouldUseAgain != null ? <Badge>{r.wouldUseAgain ? "Sẽ dùng lại" : "Sẽ không dùng lại"}</Badge> : null}
                  {r.complaintTags?.map((t) => (
                    <Badge key={t} tone="warning">
                      {COMPLAINT_TAG_LABEL[t] ?? t}
                    </Badge>
                  ))}
                </View>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>

      <BottomSheet open={adoptOpen} onClose={() => setAdoptOpen(false)} title="Áp dụng kế hoạch này">
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }}>
          {packages.length > 0 ? (
            <View className="rounded-xl bg-warning/10 p-3">
              <Text className="font-body text-xs text-foreground">
                {`Kế hoạch này cần mua gói trước khi áp dụng: ${packages.map((p) => `${p.name} (${formatVND(p.price)})`).join(", ")}. Mua ở mục "Gói tập PT".`}
              </Text>
            </View>
          ) : null}
          <View className="flex-row gap-2 rounded-xl bg-destructive/10 p-3">
            <TriangleAlert size={16} color={darkColors.destructive} />
            <Text className="flex-1 font-body text-xs text-foreground">
              Áp dụng sẽ thay thế chương trình tập đang hoạt động — các buổi đã lên lịch nhưng CHƯA tập sẽ bị huỷ. Buổi đã tập (lịch sử) vẫn giữ nguyên.
            </Text>
          </View>
          <View>
            <FieldLabel>Ngày bắt đầu</FieldLabel>
            <StartDateStrip value={startDate} onChange={setStartDate} />
          </View>
          <View>
            <FieldLabel>{`Chọn ${daysPerWeek} ngày tập trong tuần (${selected.length}/${daysPerWeek})`}</FieldLabel>
            <WeekdayPicker
              options={WEEKDAY_OPTIONS}
              selected={selected}
              limit={daysPerWeek}
              onToggle={(w) => setWeekdays(toggleAdoptWeekday(selected, w, daysPerWeek))}
            />
          </View>
          {days.length > 0 ? (
            <View>
              <Tappable className="flex-row items-center gap-1" onPress={() => setCustomize((v) => !v)}>
                {customize ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
                <Text className="font-body text-xs text-muted-foreground">Tuỳ chỉnh bài tập trước khi áp dụng (không bắt buộc)</Text>
              </Tappable>
              {customize ? (
                <View className="mt-2 gap-3 rounded-xl bg-panel p-3">
                  <Text className="font-body text-[11px] text-muted-foreground">
                    Bỏ chọn bài bạn không tập được, hoặc chỉnh số hiệp. Mỗi ngày phải giữ ít nhất 1 bài.
                  </Text>
                  {days.map((d, di) => (
                    <View key={di} className="gap-1.5">
                      <Text className="font-body-semibold text-xs text-foreground">{d.day}</Text>
                      {d.exercises.map((ex, ei) => {
                        const k = exerciseKey(di, ei);
                        const off = excluded.has(k);
                        return (
                          <View key={ei} className="flex-row items-center gap-2">
                            <Tappable
                              accessibilityLabel={off ? `Giữ ${ex.name}` : `Bỏ ${ex.name}`}
                              onPress={() =>
                                setExcluded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(k)) next.delete(k);
                                  else next.add(k);
                                  return next;
                                })
                              }
                              className={`h-6 w-6 items-center justify-center rounded-md border ${off ? "border-border" : "border-primary bg-primary"}`}
                            >
                              {off ? null : <Check size={14} strokeWidth={3} color={accent.onPrimary} />}
                            </Tappable>
                            <Text className={`flex-1 font-body text-xs ${off ? "text-muted-foreground line-through" : "text-foreground"}`} numberOfLines={1}>
                              {ex.name}
                            </Text>
                            {off ? null : (
                              <Stepper
                                value={setsOverride[k] ?? ex.sets}
                                min={1}
                                max={20}
                                suffix="hiệp"
                                onChange={(n) => setSetsOverride((prev) => ({ ...prev, [k]: n }))}
                              />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                  {custom.emptyDay ? <Text className="font-body text-xs text-destructive">Mỗi ngày cần giữ lại ít nhất 1 bài tập.</Text> : null}
                </View>
              ) : null}
            </View>
          ) : null}
          <Tappable className="flex-row items-start gap-2" onPress={() => setConfirmed((v) => !v)}>
            <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${confirmed ? "border-primary bg-primary" : "border-border"}`}>
              {confirmed ? <Check size={13} strokeWidth={3} color={accent.onPrimary} /> : null}
            </View>
            <Text className="flex-1 font-body text-xs text-foreground">Tôi hiểu rằng chương trình tập hiện tại của tôi sẽ bị thay thế.</Text>
          </Tappable>
          {blocked ? <Text className="font-body text-xs text-muted-foreground">{blocked}</Text> : null}
          <Button full size="lg" icon={CalendarPlus} disabled={!!blocked || adopt.isPending} onPress={() => adopt.mutate()}>
            {adopt.isPending ? "Đang áp dụng…" : "Áp dụng"}
          </Button>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
