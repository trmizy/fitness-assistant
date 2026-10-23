import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Repeat, UserRound } from "lucide-react-native";

import { BottomSheet, Button, Card, EmptyState, Input, ScreenHeader, inputPlaceholderColor, useToast } from "../../src/components/ui";
import { SelectField } from "../../src/components/SelectSheet";
import { collaborationService, gymService, profileService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { normalizePt } from "../../src/features/services/ptDiscovery";
import { MIN_PLATFORM_RATE, ratesError, ratesPayload } from "../../src/features/collaboration/collaboration";
import {
  PT_NAME_FALLBACK,
  SIGNED_CONTRACTS_NOTE,
  buildPartnershipSections,
  optionLabel,
  optionNote,
  ownerIntroCopy,
  ownerProposalOptions,
  proposeCopy,
  ptDisplayName,
  terminatedToast,
} from "../../src/features/collaboration/brandPartnership";
import {
  PartnershipList,
  TerminateSheet,
  type CounterTarget,
  type ProposeTarget,
  type TerminateTarget,
} from "../../src/features/collaboration/PartnershipCards";
import { isBrandOwner, isManagerAccount, ownedGyms } from "../../src/features/gymOwner/gymOwner";

type RateForm = { pt: string; gym: string; platform: string; note: string };
const DEFAULT_RATES: RateForm = { pt: "60", gym: "30", platform: "10", note: "" };
const pctOf = (fraction: string | null, fallback: string) => (fraction == null ? fallback : String(Math.round(Number(fraction) * 100)));

/**
 * GY-06 - "Hợp tác huấn luyện viên", nhìn từ ghế CHỦ GYM. Thỏa thuận được ký ở cấp THƯƠNG HIỆU (D5/D72): mời,
 * thương thảo, chấp nhận và chấm dứt (báo trước do máy chủ đặt) đều với thương hiệu của chủ gym, một bộ tỷ lệ
 * cho mọi chi nhánh đang mở; chi nhánh bao phủ chỉ được liệt kê, không có tỷ lệ riêng. Điều khoản cũ theo chi
 * nhánh hiện đúng là điều khoản cũ. Tên huấn luyện viên được tra theo từng người (không bao giờ hiện mã).
 * Quản lý chi nhánh không đọc được điều khoản (D14) - máy chủ trả 403 và màn này nói rõ.
 */
export default function GymOwnerCollaborationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [propose, setPropose] = useState<ProposeTarget | null>(null);
  const [ptUserId, setPtUserId] = useState("");
  const [form, setForm] = useState<RateForm>(DEFAULT_RATES);
  const [counterFor, setCounterFor] = useState<CounterTarget | null>(null);
  const [counter, setCounter] = useState<RateForm>(DEFAULT_RATES);
  const [terminateFor, setTerminateFor] = useState<TerminateTarget | null>(null);

  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const isOwner = isBrandOwner(statusQuery.data);
  // GET /owner/collaborations is OWNER-only (403 OWNER_ROLE_REQUIRED); web hides the page from a manager.
  const manager = isManagerAccount(statusQuery.data);

  const query = useQuery({
    queryKey: ["owner-collaborations", uid],
    queryFn: () => collaborationService.listForOwner(),
    enabled: statusQuery.isSuccess && !manager,
  });
  const sections = useMemo(() => buildPartnershipSections(query.data, "GYM"), [query.data]);
  const allCards = [...sections.needsReply, ...sections.current, ...sections.ended];
  const hasAny = allCards.length > 0;

  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  // The owner's brand plus any brandless gym of theirs (single-branch agreement of old).
  const options = useMemo(() => ownerProposalOptions(ownedGyms(gymsQuery.data)), [gymsQuery.data]);
  const [optionId, setOptionId] = useState("");
  const brand = options.find((o) => o.brandId === (propose?.brandId || optionId)) ?? options[0] ?? null;

  // Names of the trainers on the cards, looked up per person (cached) - an id is never shown.
  const ptIds = useMemo(() => [...new Set(allCards.map((c) => c.ptUserId).filter(Boolean))], [allCards.length, query.data]);
  const nameQueries = useQueries({
    queries: ptIds.map((id) => ({
      queryKey: ["pt-display-name", id],
      queryFn: async () => ptDisplayName(await profileService.getPTDetail(id)),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const names = new Map<string, string>(ptIds.map((id, i) => [id, nameQueries[i]?.data ?? PT_NAME_FALLBACK]));
  const nameOf = (id: string) => names.get(id) ?? PT_NAME_FALLBACK;

  const ptsQuery = useQuery({
    queryKey: ["pt-directory"],
    queryFn: () => profileService.listPTs(),
    staleTime: 5 * 60_000,
    enabled: !!propose,
  });
  const pts = useMemo(() => {
    const raw = ptsQuery.data as any;
    const list = Array.isArray(raw) ? raw : (raw?.data ?? raw?.pts ?? []);
    return (Array.isArray(list) ? list : []).map(normalizePt).filter((p) => p.userId);
  }, [ptsQuery.data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["owner-collaborations", uid] });
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const doorBranchId = propose?.doorBranchId ?? brand?.proposeBranchId ?? "";
  const targetPt = propose?.ptUserId ?? ptUserId;

  const invite = useMutation({
    mutationFn: () =>
      collaborationService.proposeAsGym(doorBranchId, {
        ptUserId: targetPt,
        ...ratesPayload(form.pt, form.gym, form.platform),
        note: form.note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.show("Đã gửi lời mời hợp tác", "success");
      setPropose(null);
      setForm(DEFAULT_RATES);
      setPtUserId("");
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được lời mời"),
  });

  const respond = useMutation({
    mutationFn: (v: { id: string; action: "ACCEPT" | "REJECT" | "COUNTER" }) =>
      collaborationService.respond(v.id, "GYM", {
        action: v.action,
        ...(v.action === "COUNTER"
          ? { ...ratesPayload(counter.pt, counter.gym, counter.platform), note: counter.note.trim() || undefined }
          : {}),
      }),
    onSuccess: (_d, v) => {
      toast.show(v.action === "ACCEPT" ? "Đã nhận hợp tác" : v.action === "REJECT" ? "Đã từ chối" : "Đã gửi tỷ lệ đề nghị lại", "success");
      setCounterFor(null);
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được phản hồi"),
  });

  const terminate = useMutation({
    mutationFn: (id: string) => collaborationService.terminate(id, "GYM"),
    onSuccess: (result) => {
      toast.show(terminatedToast(result), "success");
      setTerminateFor(null);
      invalidate();
    },
    onError: (e) => fail(e, "Không chấm dứt được hợp tác"),
  });

  const inviteError = !doorBranchId
    ? "Bạn chưa có chi nhánh nào được duyệt để hợp tác."
    : !targetPt
      ? "Chọn huấn luyện viên."
      : ratesError(form.pt, form.gym, form.platform);
  const counterError = ratesError(counter.pt, counter.gym, counter.platform);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-owner/dashboard"));
  const openPropose = (t: ProposeTarget) => {
    setForm(DEFAULT_RATES);
    setPtUserId("");
    setOptionId(t.brandId ?? "");
    setPropose(t);
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Hợp tác huấn luyện viên" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <Card className="mb-4 flex-row items-start gap-2.5 p-4">
          <Handshake size={17} color={accent.primary} />
          <Text className="flex-1 font-body text-sm leading-5 text-muted-foreground">
            {ownerIntroCopy(options)} {SIGNED_CONTRACTS_NOTE}
          </Text>
        </Card>

        {isOwner ? (
          <Button full icon={Handshake} className="mb-4" disabled={!brand} onPress={() => openPropose({})}>
            Mời huấn luyện viên
          </Button>
        ) : null}

        {statusQuery.isLoading || query.isLoading ? (
          <ActivityIndicator className="mt-6" color={accent.primary} />
        ) : manager ? (
          <EmptyState icon={Handshake} title="Chỉ dành cho chủ phòng gym" description="Điều khoản hợp tác với huấn luyện viên do chủ phòng gym quản lý." />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được danh sách hợp tác. Kéo xuống để thử lại.</Text>
        ) : !hasAny ? (
          <EmptyState icon={UserRound} title="Chưa có hợp tác nào" description="Mời một huấn luyện viên hợp tác với thương hiệu để họ nhận học viên tại mọi chi nhánh." />
        ) : (
          <PartnershipList
            sections={sections}
            viewer="GYM"
            nameOf={nameOf}
            handlers={{
              busy: respond.isPending || terminate.isPending,
              onAccept: (id) => respond.mutate({ id, action: "ACCEPT" }),
              onReject: (id) => respond.mutate({ id, action: "REJECT" }),
              onCounter: (t) => {
                setCounter({ pt: pctOf(t.pt, "60"), gym: pctOf(t.gym, "30"), platform: pctOf(t.platform, "10"), note: "" });
                setCounterFor(t);
              },
              onTerminate: isOwner ? setTerminateFor : () => undefined,
              onPropose: openPropose,
            }}
          />
        )}
      </ScrollView>

      {/* Mời huấn luyện viên / hợp tác lại / đề xuất thỏa thuận chung */}
      <BottomSheet open={!!propose} onClose={() => setPropose(null)} title={proposeCopy("GYM", !!propose?.repartner).title}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          {options.length > 1 && !propose?.brandId ? (
            <SelectField
              label="Hợp tác cho"
              value={brand?.brandId ?? ""}
              options={options.map((o) => ({ value: o.brandId, label: optionLabel(o) }))}
              onChange={setOptionId}
            />
          ) : null}
          {brand ? (
            <Text testID="collab-option-note" className="font-body text-sm text-muted-foreground">
              {brand.scope === "BRAND" ? `Thương hiệu ${brand.brandName} — ` : `${brand.brandName} — `}
              {optionNote(brand)}
            </Text>
          ) : null}
          {propose?.ptUserId ? (
            <Text className="font-body-semibold text-sm text-foreground">{nameOf(propose.ptUserId)}</Text>
          ) : (
            <SelectField
              label="Huấn luyện viên"
              value={ptUserId}
              options={pts.map((p) => ({ value: p.userId, label: p.name }))}
              loading={ptsQuery.isLoading}
              onChange={setPtUserId}
              allowClear
            />
          )}
          <RateFields form={form} setForm={setForm} branchOnly={brand?.scope === "BRANCH"} />
          <Button disabled={!!inviteError || invite.isPending} onPress={() => invite.mutate()}>
            {invite.isPending ? "Đang gửi…" : proposeCopy("GYM", false).submit}
          </Button>
          {inviteError ? <Text className="text-center font-body text-xs text-muted-foreground">{inviteError}</Text> : null}
        </ScrollView>
      </BottomSheet>

      {/* Đề xuất lại tỷ lệ */}
      <BottomSheet open={!!counterFor} onClose={() => setCounterFor(null)} title="Đề xuất lại">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Text className="font-body text-sm text-muted-foreground">{counterFor?.title}</Text>
          <RateFields form={counter} setForm={setCounter} branchOnly={!!counterFor?.branchOnly} />
          <Button variant="secondary" icon={Repeat} disabled={!!counterError || respond.isPending} onPress={() => counterFor && respond.mutate({ id: counterFor.id, action: "COUNTER" })}>
            Gửi tỷ lệ đề nghị lại
          </Button>
          {counterError ? <Text className="text-center font-body text-xs text-muted-foreground">{counterError}</Text> : null}
        </ScrollView>
      </BottomSheet>

      <TerminateSheet target={terminateFor} pending={terminate.isPending} onClose={() => setTerminateFor(null)} onConfirm={(id) => terminate.mutate(id)} />
    </View>
  );
}

function RateFields({ form, setForm, branchOnly }: { form: RateForm; setForm: (f: RateForm | ((p: RateForm) => RateForm)) => void; branchOnly: boolean }) {
  const only = (v: string) => v.replace(/[^\d]/g, "");
  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <Input className="flex-1" label="HLV (%)" value={form.pt} onChangeText={(v) => setForm((f) => ({ ...f, pt: only(v) }))} keyboardType="number-pad" placeholderTextColor={inputPlaceholderColor} />
        <Input className="flex-1" label="Bạn (%)" value={form.gym} onChangeText={(v) => setForm((f) => ({ ...f, gym: only(v) }))} keyboardType="number-pad" placeholderTextColor={inputPlaceholderColor} />
        <Input className="flex-1" label="Nền tảng (%)" value={form.platform} onChangeText={(v) => setForm((f) => ({ ...f, platform: only(v) }))} keyboardType="number-pad" placeholderTextColor={inputPlaceholderColor} />
      </View>
      <Text className="font-body text-[11px] text-muted-foreground">
        {branchOnly ? "Tỷ lệ chỉ áp dụng riêng cho chi nhánh này." : "Một bộ tỷ lệ cho cả thương hiệu."} Ba tỷ lệ phải cộng đúng 100%, phần nền tảng không dưới {MIN_PLATFORM_RATE * 100}%.
      </Text>
      <Input
        label="Ghi chú (tuỳ chọn)"
        value={form.note}
        onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
        placeholder="Vài dòng cho bên kia"
        placeholderTextColor={inputPlaceholderColor}
        multiline
        numberOfLines={2}
      />
    </View>
  );
}
