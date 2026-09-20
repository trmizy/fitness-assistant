import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronLeft,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Star,
  TriangleAlert,
  UserSearch,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Segmented,
  Tappable,
  useToast,
} from "../../../../src/components/ui";
import {
  collaborationService,
  contractService,
  profileService,
  ptServicePackageService,
} from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { formatVND } from "../../../../src/utils/currency";
import {
  buildContractRequestPayload,
  lowAvailabilityMessage,
  mergePtSources,
  normalizePackages,
  normalizePartnerGyms,
  normalizePts,
  pricePerSession,
  ratesLabel,
  readLowAvailability,
  requestBlockedReason,
  serviceModeLabel,
  type LowAvailability,
  type ServicePackage,
} from "../../../../src/features/services/ptDiscovery";

const SEGMENTS = ["Giới thiệu", "Gói dịch vụ", "Đánh giá"];

/**
 * CL-10 (trainer detail) + CL-11 (coaching request) — one screen, because the request is a decision
 * about a package and the packages are what this screen is for.
 *
 * The request itself is the product's first money-adjacent write, so it follows the server exactly:
 * a `packageId` (never a price), a gym only on an OFFLINE package and only one the trainer has an
 * ACCEPTED partnership with, and the 409 LOW_AVAILABILITY answer treated as a warning to
 * acknowledge rather than a failure — re-sent with `acknowledgedLowAvailability: true` if the
 * client still wants to go ahead.
 *
 * Phase 7 stops here on purpose: the contract lands in PENDING_REVIEW, and paying it opens a real
 * gateway, which is Phase 14's work.
 */
export default function TrainerDetailScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ptUserId = String(id ?? "");

  const [segment, setSegment] = useState(SEGMENTS[0]);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [gymId, setGymId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [lowAvailability, setLowAvailability] = useState<LowAvailability | null>(null);

  const detailQuery = useQuery({
    queryKey: ["pt-detail", ptUserId],
    queryFn: () => profileService.getPTDetail(ptUserId),
    enabled: !!ptUserId,
  });

  const packagesQuery = useQuery({
    queryKey: ["pt-packages", ptUserId],
    queryFn: () => ptServicePackageService.getPackagesForPT(ptUserId),
    enabled: !!ptUserId,
  });

  const gymsQuery = useQuery({
    queryKey: ["pt-partner-gyms", ptUserId],
    queryFn: () => collaborationService.listGymsForPt(ptUserId),
    enabled: !!ptUserId,
  });

  // The detail endpoint does not return `ptApplication` or the free-slot count — only the list
  // does (see mergePtSources). This shares the list screen's own query key, so arriving from an
  // unfiltered list costs nothing; arriving from a filtered one fetches the list once.
  const listQuery = useQuery({
    queryKey: ["pts-list", {}],
    queryFn: () => profileService.listPTs({}),
    staleTime: 60_000,
  });

  const raw = (detailQuery.data as any)?.pt ?? (detailQuery.data as any)?.profile ?? detailQuery.data;
  const listRow = useMemo(
    () => normalizePts(listQuery.data).find((row) => row.userId === ptUserId) ?? null,
    [listQuery.data, ptUserId],
  );
  const pt = useMemo(() => mergePtSources(raw, listRow), [raw, listRow]);
  const packages = useMemo(() => normalizePackages(packagesQuery.data), [packagesQuery.data]);
  const selected = packages.find((p) => p.id === packageId) ?? null;
  const partnerGyms = useMemo(() => normalizePartnerGyms(gymsQuery.data), [gymsQuery.data]);
  const reviews: any[] = Array.isArray((raw as any)?.recentReviews) ? (raw as any).recentReviews : [];

  const blocked = pt ? requestBlockedReason(pt, selected) : "Đang tải huấn luyện viên...";

  const requestMutation = useMutation({
    mutationFn: (acknowledged: boolean) =>
      contractService.requestContract(
        buildContractRequestPayload({
          ptUserId,
          pkg: selected!,
          gymId,
          message,
          acknowledgedLowAvailability: acknowledged,
        }) as any,
      ),
    onSuccess: () => {
      setLowAvailability(null);
      void queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
      toast.show("Đã gửi yêu cầu — huấn luyện viên sẽ xem xét và phản hồi.", "success");
      if (router.canGoBack()) router.back();
      else router.replace("/client/services");
    },
    onError: (error: any) => {
      const info = readLowAvailability(error);
      if (info) {
        // Not a failure: the server is asking whether the client accepts a thinner calendar.
        setLowAvailability(info);
        return;
      }
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không gửi được yêu cầu",
        "danger",
      );
    },
  });

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}>
        <View className="flex-row items-center gap-2 px-5">
          <Tappable
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/client/services");
            }}
          >
            <ChevronLeft size={20} color="#8b9299" />
          </Tappable>
          <Text className="flex-1 font-display text-xl text-foreground" numberOfLines={1}>
            {pt?.name ?? "Huấn luyện viên"}
          </Text>
        </View>

        {detailQuery.isLoading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : !pt ? (
          <EmptyState
            icon={UserSearch}
            title="Không đọc được hồ sơ huấn luyện viên"
            description="Thử lại khi có kết nối, hoặc chọn huấn luyện viên khác."
          />
        ) : (
          <View className="gap-4 px-5 pt-4">
            <Card className="p-4">
              <View className="flex-row gap-3.5">
                <Avatar uri={pt.photoUrl} name={pt.name} size={64} />
                <View className="flex-1">
                  <View className="flex-row items-center gap-1.5">
                    <Text className="font-display text-lg text-foreground" numberOfLines={1}>
                      {pt.name}
                    </Text>
                    <ShieldCheck size={16} color={accent.primary} />
                  </View>
                  <Text className="font-body text-xs text-muted-foreground">
                    {serviceModeLabel(pt.serviceMode)}
                  </Text>
                  <View className="mt-1.5 flex-row items-center gap-3">
                    {pt.rating != null ? (
                      <View className="flex-row items-center gap-1">
                        <Star size={13} color="#f59e0b" fill="#f59e0b" />
                        <Text className="font-body-medium text-xs text-foreground">
                          {pt.rating.toFixed(1)}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground">
                          ({pt.ratingCount})
                        </Text>
                      </View>
                    ) : (
                      <Text className="font-body text-xs text-muted-foreground">Chưa có đánh giá</Text>
                    )}
                    {pt.area ? (
                      <View className="flex-row items-center gap-1">
                        <MapPin size={12} color="#8b9299" />
                        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                          {pt.area}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              <View className="mt-3 flex-row flex-wrap gap-1.5">
                {pt.specialties.map((s) => (
                  <Badge key={s} tone="neutral">
                    {s}
                  </Badge>
                ))}
                {pt.slots28 != null ? (
                  // One string, not [number, string]: Badge only wraps a single string child in a
                  // <Text>, and an array child leaks the words out as raw text nodes.
                  <Badge tone="info">{`${pt.slots28} khung giờ trống / 28 ngày`}</Badge>
                ) : null}
              </View>

              {pt.suspended || !pt.acceptingClients ? (
                <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-border bg-panel p-3">
                  <TriangleAlert size={16} color="#f59e0b" />
                  <Text className="flex-1 font-body text-xs text-muted-foreground">
                    {requestBlockedReason(pt, selected)}
                  </Text>
                </View>
              ) : null}
            </Card>

            <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />

            {segment === "Giới thiệu" ? (
              <Card className="gap-3 p-4">
                {pt.bio ? (
                  <Text className="font-body text-sm leading-6 text-foreground">{pt.bio}</Text>
                ) : (
                  <Text className="font-body text-sm text-muted-foreground">
                    Huấn luyện viên chưa viết phần giới thiệu.
                  </Text>
                )}
                {pt.yearsOfExperience ? (
                  <View className="flex-row items-center gap-2">
                    <Text className="font-body text-xs text-muted-foreground">Kinh nghiệm</Text>
                    <Text className="font-body-medium text-xs text-foreground">
                      {pt.yearsOfExperience} năm
                    </Text>
                  </View>
                ) : null}
                {pt.gymAffiliation ? (
                  <View className="flex-row items-center gap-2">
                    <Building2 size={14} color="#8b9299" />
                    <Text className="flex-1 font-body text-xs text-muted-foreground">
                      {pt.gymAffiliation}
                    </Text>
                  </View>
                ) : null}
              </Card>
            ) : null}

            {segment === "Gói dịch vụ" ? (
              <View className="gap-3">
                {packagesQuery.isLoading ? (
                  <View className="items-center py-10">
                    <ActivityIndicator color={accent.primary} />
                  </View>
                ) : packages.length === 0 ? (
                  <Card className="p-4">
                    <Text className="font-body text-sm text-muted-foreground">
                      Huấn luyện viên chưa đăng gói dịch vụ nào. Hãy nhắn tin để hỏi trực tiếp.
                    </Text>
                  </Card>
                ) : (
                  packages.map((pkg) => (
                    <PackageCard
                      key={pkg.id}
                      pkg={pkg}
                      selected={pkg.id === packageId}
                      onPress={() => {
                        setPackageId(pkg.id);
                        if (pkg.sessionMode !== "OFFLINE") setGymId(null);
                      }}
                    />
                  ))
                )}

                {selected?.sessionMode === "OFFLINE" ? (
                  <Card className="gap-2 p-4">
                    <Text className="font-body-medium text-sm text-foreground">
                      Tập tại phòng gym nào?
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground">
                      Chỉ chọn được phòng gym đã hợp tác với huấn luyện viên — phần chia doanh thu
                      phải đến từ thoả thuận có thật.
                    </Text>
                    {partnerGyms.length === 0 ? (
                      <Text className="mt-1 font-body text-xs text-muted-foreground">
                        Huấn luyện viên chưa hợp tác với phòng gym nào; yêu cầu sẽ được gửi dạng độc lập.
                      </Text>
                    ) : (
                      <View className="mt-1 gap-2">
                        {partnerGyms.map((gym) => {
                          const active = gym.gymId === gymId;
                          const rates = ratesLabel(gym);
                          return (
                            <Tappable
                              key={gym.gymId}
                              className={`flex-row items-center justify-between gap-2 rounded-xl border px-3.5 py-3 ${
                                active ? "border-primary bg-primary/10" : "border-border bg-panel"
                              }`}
                              onPress={() => setGymId(active ? null : gym.gymId)}
                            >
                              <View className="flex-1">
                                <Text className="font-body text-sm text-foreground" numberOfLines={1}>
                                  {gym.name}
                                </Text>
                                <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                                  {[gym.city, rates].filter(Boolean).join(" · ")}
                                </Text>
                              </View>
                              {active ? <Check size={16} color={accent.primary} /> : null}
                            </Tappable>
                          );
                        })}
                      </View>
                    )}
                  </Card>
                ) : null}

                <Card className="gap-2 p-4">
                  <Text className="font-body-medium text-sm text-foreground">Lời nhắn (tuỳ chọn)</Text>
                  <Input
                    value={message}
                    onChangeText={setMessage}
                    placeholder="Mục tiêu của bạn, lịch rảnh, điều PT cần biết..."
                    multiline
                    numberOfLines={4}
                    icon={MessageSquare}
                  />
                </Card>

                <Button
                  full
                  disabled={!!blocked || requestMutation.isPending}
                  onPress={() => requestMutation.mutate(false)}
                >
                  {requestMutation.isPending ? "Đang gửi..." : "Gửi yêu cầu huấn luyện"}
                </Button>
                {blocked ? (
                  <Text className="text-center font-body text-xs text-muted-foreground">{blocked}</Text>
                ) : (
                  <Text className="text-center font-body text-xs text-muted-foreground">
                    Gửi xong, huấn luyện viên sẽ xem xét. Chỉ khi PT đồng ý mới tới bước thanh toán.
                  </Text>
                )}
              </View>
            ) : null}

            {segment === "Đánh giá" ? (
              <View className="gap-3">
                {reviews.length === 0 ? (
                  <Card className="p-4">
                    <Text className="font-body text-sm text-muted-foreground">
                      Chưa có đánh giá nào cho huấn luyện viên này.
                    </Text>
                  </Card>
                ) : (
                  reviews.map((review: any, index: number) => (
                    <Card key={review?.id ?? index} className="gap-1.5 p-4">
                      <View className="flex-row items-center gap-1.5">
                        <Star size={13} color="#f59e0b" fill="#f59e0b" />
                        <Text className="font-body-medium text-sm text-foreground">
                          {Number(review?.rating ?? 0).toFixed(1)}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground">
                          {review?.clientName ?? review?.reviewerName ?? "Học viên"}
                        </Text>
                      </View>
                      {review?.comment ? (
                        <Text className="font-body text-sm leading-6 text-foreground">
                          {review.comment}
                        </Text>
                      ) : null}
                    </Card>
                  ))
                )}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <BottomSheet
        open={!!lowAvailability}
        onClose={() => setLowAvailability(null)}
        title="Huấn luyện viên còn ít khung giờ trống"
      >
        <View className="gap-4 pb-2">
          <Text className="font-body text-sm leading-6 text-foreground">
            {lowAvailability ? lowAvailabilityMessage(lowAvailability) : ""}
          </Text>
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setLowAvailability(null)}>
              Để sau
            </Button>
            <Button
              className="flex-1"
              disabled={requestMutation.isPending}
              onPress={() => requestMutation.mutate(true)}
            >
              Vẫn gửi yêu cầu
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function PackageCard({
  pkg,
  selected,
  onPress,
}: {
  pkg: ServicePackage;
  selected: boolean;
  onPress: () => void;
}) {
  const accent = useWorkspaceAccent();
  const perSession = pricePerSession(pkg);
  return (
    <Tappable onPress={onPress}>
      <Card className={`p-4 ${selected ? "border-primary" : ""}`}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="font-display text-base text-foreground">{pkg.name}</Text>
            <Text className="mt-0.5 font-body text-xs text-muted-foreground">
              {pkg.sessionCount} buổi · {serviceModeLabel(pkg.sessionMode)}
            </Text>
            {pkg.description ? (
              <Text className="mt-1.5 font-body text-xs text-muted-foreground" numberOfLines={3}>
                {pkg.description}
              </Text>
            ) : null}
          </View>
          <View className="items-end">
            <Text className="font-display text-base" style={{ color: accent.primary }}>
              {formatVND(pkg.price)}
            </Text>
            {perSession != null ? (
              <Text className="font-body text-[11px] text-muted-foreground">
                {formatVND(perSession)}/buổi
              </Text>
            ) : null}
            {selected ? (
              <View className="mt-2 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: accent.primary }}>
                <Check size={14} color="#0b0f0d" />
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </Tappable>
  );
}
