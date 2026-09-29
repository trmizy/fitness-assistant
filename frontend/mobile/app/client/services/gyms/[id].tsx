import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronLeft,
  Dumbbell,
  ExternalLink,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Signpost,
  Ticket,
  TriangleAlert,
} from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Tappable,
  useToast,
} from "../../../../src/components/ui";
import { gymService, locationService } from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { formatVND } from "../../../../src/utils/currency";
import { BranchMap } from "../../../../src/features/services/BranchMap";
import { GymPhotoGallery } from "../../../../src/features/services/GymPhotoGallery";
import {
  aboutText,
  daysRemaining,
  directionsUrl,
  facilityLabels,
  fullAddress,
  socialLinks,
  gymBlockedReason,
  membershipStatusLabel,
  multiGymWarningText,
  normalizeGym,
  normalizeMemberships,
  normalizePlans,
  normalizeWarnings,
  planDurationLabel,
  planOnSale,
  planVisitsLabel,
  purchaseBlockedReason,
  type PlanRow,
} from "../../../../src/features/services/gymDirectory";

/**
 * CL-09 — a gym and its membership plans.
 *
 * Three server rules are mirrored here so the screen never offers what the server will refuse:
 * both status axes must be open, a plan must be ACTIVE and inside its sale window, and a client may
 * hold only ONE open membership per gym (the DB enforces it with a unique index).
 *
 * The multi-gym warning is a WARNING: holding a membership elsewhere never blocks a purchase, it
 * only has to be shown and acknowledged, and that acknowledgement rides along as `multiGymWarned` —
 * evidence that the client was told, not a permission gate.
 *
 * Phase 7 stops at "chờ thanh toán" by design: the purchase creates the membership (the row exists
 * before payment is ever attempted) and the gateway itself is Phase 14's work, so this screen
 * deliberately does not open a checkout page.
 */
export default function GymDetailScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gymId = String(id ?? "");

  const [planId, setPlanId] = useState<string | null>(null);
  const [referral, setReferral] = useState("");
  const [warningOpen, setWarningOpen] = useState(false);

  const gymQuery = useQuery({
    queryKey: ["gym", gymId],
    queryFn: () => gymService.getGym(gymId),
    enabled: !!gymId,
  });

  const plansQuery = useQuery({
    queryKey: ["gym-plans", gymId],
    queryFn: () => gymService.listPlans(gymId),
    enabled: !!gymId,
  });

  const warningsQuery = useQuery({
    queryKey: ["membership-warnings", gymId],
    queryFn: () => gymService.getMembershipWarnings(gymId),
    enabled: !!gymId,
  });

  const membershipsQuery = useQuery({
    queryKey: ["my-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });

  const gym = useMemo(() => (gymQuery.data ? normalizeGym(gymQuery.data) : null), [gymQuery.data]);
  // Tên phường/tỉnh tra từ mã (gym chỉ lưu mã) — cùng nguồn /locations/* với web; lỗi thì chỉ thiếu tên.
  const provincesQuery = useQuery({
    queryKey: ["locations", "provinces"],
    queryFn: () => locationService.getProvinces(),
    staleTime: 24 * 60 * 60 * 1000,
    enabled: gym?.provinceCode != null,
  });
  const wardsQuery = useQuery({
    queryKey: ["locations", "wards", gym?.provinceCode],
    queryFn: () => locationService.getWards(gym!.provinceCode!),
    staleTime: 24 * 60 * 60 * 1000,
    enabled: gym?.provinceCode != null,
  });
  const address = gym
    ? fullAddress(gym, {
        province: provincesQuery.data?.find((p) => p.code === gym.provinceCode)?.name ?? null,
        ward: wardsQuery.data?.find((w) => w.code === gym.wardCode)?.name ?? null,
      })
    : "";
  const about = gym ? aboutText(gym) : null;
  const socials = gym ? socialLinks(gym) : [];
  const directions = gym ? directionsUrl(gym) : null;
  const otherBranches = gym ? gym.brandBranches.filter((b) => b.id !== gym.id) : [];
  // Bản đồ: mọi chi nhánh cùng thương hiệu; API cũ chưa có brandBranches thì ít nhất là chính chi nhánh này.
  const mapBranches = gym
    ? gym.brandBranches.length > 0
      ? gym.brandBranches
      : [{ id: gym.id, name: gym.name, address: gym.address ?? "", latitude: gym.latitude, longitude: gym.longitude }]
    : [];
  const plans = useMemo(() => normalizePlans(plansQuery.data), [plansQuery.data]);
  const onSale = useMemo(() => plans.filter((plan) => planOnSale(plan)), [plans]);
  const warnings = useMemo(() => normalizeWarnings(warningsQuery.data), [warningsQuery.data]);
  const memberships = useMemo(
    () => normalizeMemberships(membershipsQuery.data),
    [membershipsQuery.data],
  );
  const selected = onSale.find((plan) => plan.id === planId) ?? null;
  const mine = memberships.find(
    (m) => m.gymId === gymId && (m.status === "ACTIVE" || m.status === "PENDING_PAYMENT"),
  );
  const blocked = gym ? purchaseBlockedReason(gym, selected, memberships) : "Đang tải phòng gym...";
  const gymClosed = gym ? gymBlockedReason(gym) : null;

  const buyMutation = useMutation({
    mutationFn: (acknowledged: boolean) =>
      gymService.buyMembership(
        gymId,
        selected!.id,
        // No provider on purpose: Phase 7 creates the membership and stops. Opening a real gateway
        // is Phase 14, and passing a provider here would start a checkout nobody can finish yet.
        undefined,
        referral.trim() || undefined,
        acknowledged,
      ),
    onSuccess: () => {
      setWarningOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
      toast.show("Đã giữ gói cho bạn — gói đang ở trạng thái chờ thanh toán.", "success");
    },
    onError: (error: any) => {
      setWarningOpen(false);
      const code = error?.response?.data?.error ?? error?.response?.data?.message;
      toast.show(
        code === "ALREADY_HAS_PENDING_MEMBERSHIP"
          ? "Bạn đã có một gói chờ thanh toán tại phòng gym này."
          : code === "ALREADY_HAS_OPEN_MEMBERSHIP"
            ? "Bạn đang có gói còn hiệu lực tại phòng gym này."
            : (code ?? "Không mua được gói"),
        "danger",
      );
    },
  });

  const startPurchase = () => {
    if (warnings.length > 0) {
      setWarningOpen(true);
      return;
    }
    buyMutation.mutate(false);
  };

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
            {gym?.name ?? "Phòng gym"}
          </Text>
        </View>

        {gymQuery.isLoading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : !gym ? (
          <EmptyState
            icon={Building2}
            title="Không đọc được thông tin phòng gym"
            description="Thử lại khi có kết nối, hoặc chọn phòng gym khác."
          />
        ) : (
          <View className="gap-4 px-5 pt-4">
            <Card className="gap-2.5 p-4">
              <View className="flex-row items-start justify-between gap-3">
                {gym.brandLogoUrl ? (
                  <Image
                    source={{ uri: gym.brandLogoUrl }}
                    contentFit="contain"
                    style={{ width: 44, height: 44, borderRadius: 12 }}
                    accessibilityLabel={`Logo ${gym.brandName}`}
                  />
                ) : null}
                <View className="flex-1">
                  <Text className="font-display text-lg text-foreground">{gym.name}</Text>
                  <View className="mt-0.5 flex-row items-center gap-1.5">
                    <Building2 size={13} color="#8b9299" />
                    <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                      {gym.brandName}
                    </Text>
                  </View>
                </View>
                {gym.rating != null ? (
                  <Badge tone="warning">{`★ ${gym.rating.toFixed(1)} (${gym.reviewCount})`}</Badge>
                ) : (
                  <Badge tone="neutral">Chưa có đánh giá</Badge>
                )}
              </View>

              {/* CL-09 vá 21/9 theo web: "Thông tin giới thiệu" (≤300, chưa có thì của thương hiệu) đứng ĐẦU, trước ảnh. */}
              {about ? (
                <View className="gap-1 pt-1">
                  <Text className="font-body-medium text-sm text-foreground">Thông tin giới thiệu</Text>
                  <Text className="font-body text-sm leading-6 text-muted-foreground">{about}</Text>
                </View>
              ) : null}
            </Card>

            <GymPhotoGallery photos={gym.photos} title={gym.name} />

            <Card className="gap-2.5 p-4">
              {address ? (
                <View className="flex-row items-start gap-2">
                  <MapPin size={15} color="#8b9299" />
                  <Text className="flex-1 font-body text-sm text-foreground">{address}</Text>
                </View>
              ) : null}
              {gym.locationNote ? (
                <View className="flex-row items-start gap-2">
                  <Signpost size={15} color="#8b9299" />
                  <Text className="flex-1 font-body text-sm text-muted-foreground">{gym.locationNote}</Text>
                </View>
              ) : null}
              {gym.phone ? (
                <Tappable
                  className="flex-row items-center gap-2"
                  onPress={() => void Linking.openURL(`tel:${gym.phone!.replace(/\s+/g, "")}`)}
                  accessibilityLabel={`Gọi ${gym.phone}`}
                >
                  <Phone size={15} color="#8b9299" />
                  <Text className="font-body text-sm text-foreground">{gym.phone}</Text>
                </Tappable>
              ) : null}
              {gym.email ? (
                <Tappable
                  className="flex-row items-center gap-2"
                  onPress={() => void Linking.openURL(`mailto:${gym.email}`)}
                  accessibilityLabel={`Gửi email ${gym.email}`}
                >
                  <Mail size={15} color="#8b9299" />
                  <Text className="font-body text-sm text-foreground">{gym.email}</Text>
                </Tappable>
              ) : null}

              {socials.length > 0 ? (
                <View className="flex-row flex-wrap gap-2 pt-1">
                  {socials.map((so) => (
                    <Tappable
                      key={so.key}
                      onPress={() => void Linking.openURL(so.url)}
                      accessibilityLabel={so.label}
                      className="flex-row items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5"
                    >
                      <ExternalLink size={13} color="#8b9299" />
                      <Text className="font-body-medium text-xs text-foreground">{so.label}</Text>
                    </Tappable>
                  ))}
                </View>
              ) : null}

              {facilityLabels(gym.facilities).length > 0 ? (
                <View className="flex-row flex-wrap gap-1.5 pt-1">
                  {facilityLabels(gym.facilities).map((facility) => (
                    <Badge key={facility} tone="neutral">
                      {facility}
                    </Badge>
                  ))}
                </View>
              ) : null}
            </Card>

            {directions || otherBranches.length > 0 || mapBranches.some((b) => b.latitude != null) ? (
              <Card className="gap-2.5 p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 font-body-medium text-sm text-foreground">
                    {otherBranches.length > 0
                      ? `${gym.brandBranches.length} chi nhánh ${gym.brandName}`
                      : "Vị trí chi nhánh"}
                  </Text>
                  {directions ? (
                    <Button size="sm" variant="secondary" onPress={() => void Linking.openURL(directions)}>
                      <View className="flex-row items-center gap-1.5">
                        <Navigation size={13} color={accent.primary} />
                        <Text className="font-body-medium text-xs text-foreground">Chỉ đường</Text>
                      </View>
                    </Button>
                  ) : null}
                </View>
                <BranchMap branches={mapBranches} currentId={gym.id} />
                {otherBranches.map((b) => (
                  <Tappable
                    key={b.id}
                    className="flex-row items-start gap-2 rounded-lg bg-muted/40 px-3 py-2"
                    onPress={() => router.push(`/client/services/gyms/${b.id}`)}
                    accessibilityLabel={`Xem ${b.name}`}
                  >
                    <MapPin size={13} color="#8b9299" />
                    <View className="flex-1">
                      <Text className="font-body-medium text-xs text-foreground">{b.name}</Text>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {b.address}
                      </Text>
                    </View>
                  </Tappable>
                ))}
              </Card>
            ) : null}

            {gymClosed ? (
              <Card className="flex-row items-start gap-2 p-4">
                <TriangleAlert size={16} color="#ef4444" />
                <Text className="flex-1 font-body text-sm text-foreground">{gymClosed}</Text>
              </Card>
            ) : null}

            {mine ? (
              <Card className="gap-1.5 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="font-body-medium text-sm text-foreground">Gói của bạn tại đây</Text>
                  <Badge tone={membershipStatusLabel(mine.status).tone}>
                    {membershipStatusLabel(mine.status).label}
                  </Badge>
                </View>
                <Text className="font-body text-xs text-muted-foreground">
                  {formatVND(mine.price)}
                  {mine.status === "ACTIVE" && daysRemaining(mine) != null
                    ? ` · còn ${daysRemaining(mine)} ngày`
                    : ""}
                </Text>
              </Card>
            ) : null}

            <View className="gap-1">
              <Text className="font-display text-base text-foreground">Gói hội viên</Text>
              <Text className="font-body text-xs text-muted-foreground">
                Gói thuộc thương hiệu {gym.brandName} — mua ở đây dùng được ở mọi chi nhánh cùng
                thương hiệu.
              </Text>
            </View>

            {plansQuery.isLoading ? (
              <View className="items-center py-8">
                <ActivityIndicator color={accent.primary} />
              </View>
            ) : onSale.length === 0 ? (
              <Card className="p-4">
                <Text className="font-body text-sm text-muted-foreground">
                  Thương hiệu này chưa mở bán gói hội viên nào.
                </Text>
              </Card>
            ) : (
              <View className="gap-3">
                {onSale.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    selected={plan.id === planId}
                    onPress={() => setPlanId(plan.id)}
                  />
                ))}
              </View>
            )}

            {onSale.length > 0 ? (
              <>
                <Card className="gap-2 p-4">
                  <Text className="font-body-medium text-sm text-foreground">
                    Mã giới thiệu (tuỳ chọn)
                  </Text>
                  <Text className="font-body text-xs text-muted-foreground">
                    Nếu một huấn luyện viên giới thiệu bạn, nhập mã của họ. Mã sai không làm hỏng
                    giao dịch — chỉ là không ghi nhận giới thiệu.
                  </Text>
                  <Input
                    value={referral}
                    onChangeText={setReferral}
                    placeholder="VD: QGT7KPJW"
                    autoCapitalize="characters"
                    icon={Ticket}
                  />
                </Card>

                <Button full disabled={!!blocked || buyMutation.isPending} onPress={startPurchase}>
                  {buyMutation.isPending ? "Đang xử lý..." : "Mua gói hội viên"}
                </Button>
                <Text className="text-center font-body text-xs text-muted-foreground">
                  {blocked ??
                    "Gói sẽ được giữ ở trạng thái chờ thanh toán. Cổng thanh toán sẽ mở trong bản cập nhật tới."}
                </Text>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <BottomSheet
        open={warningOpen}
        onClose={() => setWarningOpen(false)}
        title="Bạn đang có gói ở phòng gym khác"
      >
        <View className="gap-4 pb-2">
          <Text className="font-body text-sm leading-6 text-foreground">
            {multiGymWarningText(warnings)}
          </Text>
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setWarningOpen(false)}>
              Để sau
            </Button>
            <Button
              className="flex-1"
              disabled={buyMutation.isPending}
              onPress={() => buyMutation.mutate(true)}
            >
              Tôi vẫn mua
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function PlanCard({
  plan,
  selected,
  onPress,
}: {
  plan: PlanRow;
  selected: boolean;
  onPress: () => void;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable onPress={onPress}>
      <Card className={`p-4 ${selected ? "border-primary" : ""}`}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="font-display text-base text-foreground">{plan.name}</Text>
            <View className="mt-0.5 flex-row items-center gap-1.5">
              <Dumbbell size={12} color="#8b9299" />
              <Text className="font-body text-xs text-muted-foreground">
                {planDurationLabel(plan)} · {planVisitsLabel(plan)}
              </Text>
            </View>
            {plan.description ? (
              <Text className="mt-1.5 font-body text-xs text-muted-foreground" numberOfLines={3}>
                {plan.description}
              </Text>
            ) : null}
          </View>
          <View className="items-end">
            <Text className="font-display text-base" style={{ color: accent.primary }}>
              {formatVND(plan.price)}
            </Text>
            {selected ? (
              <View
                className="mt-2 h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: accent.primary }}
              >
                <Check size={14} color="#0b0f0d" />
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </Tappable>
  );
}
