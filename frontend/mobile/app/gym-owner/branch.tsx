import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, CreditCard, Handshake, MapPin, QrCode, Star } from "lucide-react-native";

import { Badge, Card, ScreenHeader, Segmented, Tappable } from "../../src/components/ui";
import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors, designTokens } from "../../src/theme/colors";
import { branchAddress, branchName, branchStatus, isBrandOwner, operationalStatus, showsBranchStats } from "../../src/features/gymOwner/gymOwner";
import { closedLine } from "../../src/features/gymOwner/branchManage";
import {
  AboutSection,
  FacilitiesSection,
  HoursSection,
  LocationSection,
  MembersSection,
  NameAddressSection,
  OperationsSection,
  PhotosSection,
  VerificationSection,
  branchKeys,
} from "../../src/features/gymOwner/BranchSections";

/**
 * 14B.5 (PG-A7, GY-03) — one branch, the mobile counterpart of web `GymManagePage`: its settings
 * (name/address pending approval, about & contact, location, hours, facilities, photos, branch
 * documents) and its operational status, plus its members. Reached by tapping a branch on "Phòng
 * gym". Wallet, check-in QR, PT collaborations and brand plans already have their own screens, so
 * this one links to them instead of repeating them.
 *
 * One screen with three segments rather than one long page: each segment mounts (and fetches) only
 * when opened. A MANAGER gets only "Vận hành" — every settings write is owner-only on the server
 * (owner.routes.ts), so showing those forms would only lead to refusals.
 */
const OWNER_TABS = ["Thông tin", "Ảnh & giấy tờ", "Vận hành"] as const;
type Tab = (typeof OWNER_TABS)[number];

export default function BranchScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const id = String(gymId ?? "");
  const keys = branchKeys(uid, id);

  const gymQuery = useQuery({ queryKey: keys.gym, queryFn: () => gymService.getOwnedGym(id), enabled: !!id });
  const statusQuery = useQuery({ queryKey: ["partner-onboarding-status", uid], queryFn: () => gymService.getOnboardingStatus() });
  const isOwner = isBrandOwner(statusQuery.data);
  const [tab, setTab] = useState<Tab>("Thông tin");
  const activeTab: Tab = isOwner ? tab : "Vận hành";

  const gym: any = gymQuery.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-owner/gyms"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={gym ? branchName(gym) : "Chi nhánh"} onBack={back} />
      {gymQuery.isLoading || statusQuery.isLoading ? (
        <ActivityIndicator className="mt-10" color={accent.primary} />
      ) : !gym ? (
        <Text className="mt-6 px-5 font-body text-sm text-destructive">Không tải được chi nhánh này.</Text>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 14 }}
          refreshControl={
            <RefreshControl refreshing={gymQuery.isRefetching} onRefresh={() => void gymQuery.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
          }
        >
          <BranchHeader gym={gym} />

          {isOwner ? <Segmented options={[...OWNER_TABS]} value={tab} onChange={(v) => setTab(v as Tab)} /> : null}

          {activeTab === "Thông tin" ? (
            <>
              <NameAddressSection key={`na-${gym.id}`} uid={uid} gym={gym} />
              <AboutSection key={`ab-${gym.id}`} uid={uid} gym={gym} />
              <BrandLine brandId={gym.brandId} uid={uid} />
              <LocationSection key={`lo-${gym.id}`} uid={uid} gym={gym} />
              <HoursSection uid={uid} gymId={gym.id} />
              <FacilitiesSection key={`fa-${gym.id}`} uid={uid} gym={gym} />
            </>
          ) : null}

          {activeTab === "Ảnh & giấy tờ" ? (
            <>
              <PhotosSection uid={uid} gymId={gym.id} />
              <VerificationSection uid={uid} gymId={gym.id} />
            </>
          ) : null}

          {activeTab === "Vận hành" ? (
            <>
              <OperationsSection uid={uid} gym={gym} />
              {showsBranchStats(gym) ? (
                <Card className="p-1">
                  <LinkRow icon={QrCode} label="Mã QR check-in" last={!isOwner} onPress={() => router.push({ pathname: "/gym-owner/checkin-qr", params: { gymId: gym.id, name: branchName(gym) } })} />
                  {isOwner ? (
                    <>
                      <LinkRow icon={Handshake} label="Cộng tác huấn luyện viên" onPress={() => router.push("/gym-owner/collaborations")} />
                      <LinkRow icon={CreditCard} label="Gói hội viên (chung cho cả thương hiệu)" onPress={() => router.push("/gym-owner/plans")} last />
                    </>
                  ) : null}
                </Card>
              ) : null}
              <MembersSection gymId={gym.id} />
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function BranchHeader({ gym }: { gym: any }) {
  const st = branchStatus(gym.status);
  const op = operationalStatus(gym.operationalStatus);
  const closed = closedLine(gym);
  const notes = [gym.pendingNameNote ? `Tên: ${gym.pendingNameNote}` : null, gym.pendingAddressNote ? `Địa chỉ: ${gym.pendingAddressNote}` : null].filter(Boolean);
  return (
    <Card className="gap-2 p-4">
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Badge tone={st.tone}>{st.label}</Badge>
        {op && showsBranchStats(gym) ? <Badge tone={op.tone}>{op.label}</Badge> : null}
      </View>
      <View className="flex-row items-center gap-1">
        <MapPin size={12} color={designTokens.mutedForeground} />
        <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">{branchAddress(gym)}</Text>
      </View>
      {Number(gym.reviewCount ?? 0) > 0 ? (
        <View className="flex-row items-center gap-1">
          <Star size={12} color={designTokens.warning} fill={designTokens.warning} />
          <Text className="font-body text-xs text-muted-foreground">
            {Number(gym.averageRating ?? 0).toFixed(1)} · {gym.reviewCount} đánh giá
          </Text>
        </View>
      ) : null}
      {/* The server writes `name` and `pendingName` together; the public keeps `approvedName` until review. */}
      {gym.pendingName ? (
        <Text className="font-body text-[11px] text-warning">Tên mới đang chờ duyệt: {gym.pendingName}</Text>
      ) : null}
      {gym.pendingAddress ? (
        <Text className="font-body text-[11px] text-warning">Địa chỉ mới đang chờ duyệt: {gym.pendingAddress}</Text>
      ) : null}
      {closed ? (
        <View className="flex-row items-start gap-1">
          <AlertTriangle size={12} color={darkColors.destructive} />
          <Text className="min-w-0 flex-1 font-body text-[11px] text-destructive">{closed}</Text>
        </View>
      ) : null}
      {notes.length > 0 ? (
        <View className="gap-1 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <Text className="font-body-semibold text-xs text-warning">Gymini yêu cầu chỉnh sửa</Text>
          {notes.map((n) => (
            <Text key={String(n)} className="font-body text-xs text-foreground">
              {n}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** The brand, read-only — a branch never changes brand (GYM_BRANCH_FORM_SPEC §51/§79/§89). */
function BrandLine({ brandId, uid }: { brandId?: string | null; uid: string }) {
  const brandsQuery = useQuery({ queryKey: ["owned-brands", uid], queryFn: () => gymService.listOwnedBrands() });
  const brands: any[] = Array.isArray(brandsQuery.data) ? brandsQuery.data : [];
  const brand = brands.find((b) => b.id === brandId) ?? brands[0];
  return (
    <Card className="gap-1 p-4">
      <Text className="font-body-semibold text-sm text-foreground">Thương hiệu</Text>
      <Text className="font-body text-sm text-muted-foreground">{brand ? brand.approvedName ?? brand.name : "Chưa thiết lập thương hiệu"}</Text>
    </Card>
  );
}

function LinkRow({ icon: Icon, label, onPress, last }: { icon: any; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Tappable onPress={onPress} className={`flex-row items-center gap-3 px-3 py-3.5 ${last ? "" : "border-b border-border"}`}>
      <Icon size={16} color={designTokens.mutedForeground} />
      <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground">{label}</Text>
      <ChevronRight size={16} color={designTokens.mutedForeground} />
    </Tappable>
  );
}
