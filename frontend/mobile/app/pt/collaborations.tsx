import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Handshake, Repeat } from "lucide-react-native";

import { BottomSheet, Button, Card, EmptyState, Input, ScreenHeader, useToast } from "../../src/components/ui";
import { SelectField } from "../../src/components/SelectSheet";
import { collaborationService, gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { MIN_PLATFORM_RATE, ratesError, ratesPayload } from "../../src/features/collaboration/collaboration";
import {
  SIGNED_CONTRACTS_NOTE,
  brandOptionsFromGyms,
  brandsBlockedForProposal,
  buildPartnershipSections,
  optionLabel,
  optionNote,
  proposeCopy,
  terminatedToast,
} from "../../src/features/collaboration/brandPartnership";
import {
  PartnershipList,
  TerminateSheet,
  type CounterTarget,
  type ProposeTarget,
  type TerminateTarget,
} from "../../src/features/collaboration/PartnershipCards";

type RateForm = { pt: string; gym: string; platform: string; note: string };
const DEFAULT_RATES: RateForm = { pt: "60", gym: "30", platform: "10", note: "" };
const pctOf = (fraction: string | null, fallback: string) => (fraction == null ? fallback : String(Math.round(Number(fraction) * 100)));

/**
 * PT-13 - "Hợp tác phòng gym", nhìn từ ghế HUẤN LUYỆN VIÊN. Thỏa thuận được ký với THƯƠNG HIỆU (D5/D72): một
 * PT + một thương hiệu = một thỏa thuận, một bộ tỷ lệ cho mọi chi nhánh đang mở. Màn này đề nghị / thương
 * thảo / chấp nhận / chấm dứt (có thời gian báo trước do máy chủ đặt) với thương hiệu, và liệt kê chi nhánh
 * được áp dụng - không hiện tỷ lệ riêng của từng chi nhánh. Điều khoản cũ theo chi nhánh (dữ liệu trước đây)
 * hiện đúng là điều khoản cũ, không gộp, không tự chọn tỷ lệ. Mọi ánh xạ nằm trong brandPartnership.ts.
 */
export default function PtCollaborationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [propose, setPropose] = useState<ProposeTarget | null>(null);
  const [brandId, setBrandId] = useState("");
  const [form, setForm] = useState<RateForm>(DEFAULT_RATES);
  const [counterFor, setCounterFor] = useState<CounterTarget | null>(null);
  const [counter, setCounter] = useState<RateForm>(DEFAULT_RATES);
  const [terminateFor, setTerminateFor] = useState<TerminateTarget | null>(null);

  const query = useQuery({ queryKey: ["pt-collaborations", uid], queryFn: () => collaborationService.listMine() });
  const sections = useMemo(() => buildPartnershipSections(query.data, "PT"), [query.data]);
  const hasAny = sections.needsReply.length + sections.current.length + sections.ended.length > 0;

  const gymsQuery = useQuery({
    queryKey: ["all-gyms"],
    queryFn: () => gymService.listGyms(),
    staleTime: 5 * 60_000,
    enabled: !!propose,
  });
  const options = useMemo(() => brandOptionsFromGyms(gymsQuery.data), [gymsQuery.data]);
  const blocked = useMemo(() => brandsBlockedForProposal(query.data), [query.data]);
  const picked = options.find((o) => o.brandId === (propose?.brandId ?? brandId));
  const doorBranchId = propose?.doorBranchId ?? picked?.proposeBranchId ?? "";

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pt-collaborations", uid] });
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const send = useMutation({
    mutationFn: () =>
      collaborationService.proposeAsPt(doorBranchId, {
        ...ratesPayload(form.pt, form.gym, form.platform),
        note: form.note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.show("Đã gửi đề nghị hợp tác", "success");
      setPropose(null);
      setForm(DEFAULT_RATES);
      setBrandId("");
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được đề nghị"),
  });

  const respond = useMutation({
    mutationFn: (v: { id: string; action: "ACCEPT" | "REJECT" | "COUNTER" }) =>
      collaborationService.respond(v.id, "PT", {
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
    mutationFn: (id: string) => collaborationService.terminate(id, "PT"),
    onSuccess: (result) => {
      toast.show(terminatedToast(result), "success");
      setTerminateFor(null);
      invalidate();
    },
    onError: (e) => fail(e, "Không chấm dứt được hợp tác"),
  });

  const proposeError = !doorBranchId ? "Chọn thương hiệu hoặc chi nhánh muốn hợp tác." : ratesError(form.pt, form.gym, form.platform);
  const counterError = ratesError(counter.pt, counter.gym, counter.platform);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/profile"));
  const openPropose = (t: ProposeTarget) => {
    setForm(DEFAULT_RATES);
    setBrandId(t.brandId ?? "");
    setPropose(t);
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Hợp tác phòng gym" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <Card className="mb-4 flex-row items-start gap-2.5 p-4">
          <Handshake size={17} color={accent.primary} />
          <Text className="flex-1 font-body text-sm leading-5 text-muted-foreground">
            Hợp tác được ký với <Text className="font-body-semibold text-foreground">cả thương hiệu</Text> và áp dụng một bộ tỷ lệ
            cho mọi chi nhánh đang mở. {SIGNED_CONTRACTS_NOTE}
          </Text>
        </Card>

        <Button full icon={Handshake} className="mb-4" onPress={() => openPropose({})}>
          Đề nghị hợp tác
        </Button>

        {query.isLoading ? (
          <ActivityIndicator className="mt-6" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được danh sách hợp tác. Kéo xuống để thử lại.</Text>
        ) : !hasAny ? (
          <EmptyState
            icon={Building2}
            title="Chưa có hợp tác nào"
            description="Đề nghị hợp tác với một thương hiệu phòng gym để nhận học viên tại các chi nhánh của họ."
          />
        ) : (
          <PartnershipList
            sections={sections}
            viewer="PT"
            nameOf={() => ""}
            handlers={{
              busy: respond.isPending || terminate.isPending,
              onAccept: (id) => respond.mutate({ id, action: "ACCEPT" }),
              onReject: (id) => respond.mutate({ id, action: "REJECT" }),
              onCounter: (t) => {
                setCounter({ pt: pctOf(t.pt, "60"), gym: pctOf(t.gym, "30"), platform: pctOf(t.platform, "10"), note: "" });
                setCounterFor(t);
              },
              onTerminate: setTerminateFor,
              onPropose: openPropose,
            }}
          />
        )}
      </ScrollView>

      <BottomSheet open={!!propose} onClose={() => setPropose(null)} title={proposeCopy("PT", !!propose?.repartner).title}>
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <SelectField
              label="Hợp tác với *"
              value={propose?.brandId ?? brandId}
              options={options.map((o) => ({
                value: o.brandId,
                label: `${optionLabel(o)}${blocked.has(o.brandId) ? " — đã có đề xuất/thỏa thuận" : ""}`,
              }))}
              loading={gymsQuery.isLoading}
              onChange={(v) => {
                if (!blocked.has(v)) setBrandId(v);
              }}
            />
            {picked ? (
              <Text testID="collab-option-note" className="font-body text-xs text-muted-foreground">{optionNote(picked)}</Text>
            ) : null}
            <RateFields form={form} setForm={setForm} branchOnly={picked?.scope === "BRANCH"} />
            <Input
              label="Lời nhắn"
              value={form.note}
              onChangeText={(t) => setForm((f) => ({ ...f, note: t }))}
              placeholder="Tôi muốn nhận học viên tại thương hiệu này…"
              multiline
            />
            {proposeError ? <Text className="font-body text-xs text-destructive">{proposeError}</Text> : null}
            <Button full disabled={!!proposeError || send.isPending} onPress={() => send.mutate()}>
              {send.isPending ? "Đang gửi…" : proposeCopy("PT", false).submit}
            </Button>
          </View>
        </ScrollView>
      </BottomSheet>

      <BottomSheet open={!!counterFor} onClose={() => setCounterFor(null)} title="Đề xuất lại">
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <Text className="font-body text-sm text-muted-foreground">{counterFor?.title}</Text>
            <RateFields form={counter} setForm={setCounter} branchOnly={!!counterFor?.branchOnly} />
            <Input label="Lời nhắn" value={counter.note} onChangeText={(t) => setCounter((f) => ({ ...f, note: t }))} multiline />
            {counterError ? <Text className="font-body text-xs text-destructive">{counterError}</Text> : null}
            <Button
              full
              variant="secondary"
              icon={Repeat}
              disabled={!!counterError || respond.isPending}
              onPress={() => counterFor && respond.mutate({ id: counterFor.id, action: "COUNTER" })}
            >
              Gửi tỷ lệ đề nghị lại
            </Button>
          </View>
        </ScrollView>
      </BottomSheet>

      <TerminateSheet target={terminateFor} pending={terminate.isPending} onClose={() => setTerminateFor(null)} onConfirm={(id) => terminate.mutate(id)} />
    </View>
  );
}

function RateFields({ form, setForm, branchOnly }: { form: RateForm; setForm: (f: (p: RateForm) => RateForm) => void; branchOnly: boolean }) {
  const sum = Number(form.pt) + Number(form.gym) + Number(form.platform);
  return (
    <View className="gap-2">
      <Text className="font-body text-xs text-muted-foreground">
        {branchOnly ? "Tỷ lệ chỉ áp dụng riêng cho chi nhánh này" : "Một bộ tỷ lệ cho cả thương hiệu"}, theo phần trăm — ba ô phải cộng đúng 100%, phần nền tảng tối thiểu {MIN_PLATFORM_RATE * 100}%.
      </Text>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Input
            label="Bạn (%)"
            value={form.pt}
            onChangeText={(t) => setForm((f) => ({ ...f, pt: t.replace(/[^\d]/g, "") }))}
            keyboardType="number-pad"
          />
        </View>
        <View className="flex-1">
          <Input
            label="Phòng gym (%)"
            value={form.gym}
            onChangeText={(t) => setForm((f) => ({ ...f, gym: t.replace(/[^\d]/g, "") }))}
            keyboardType="number-pad"
          />
        </View>
        <View className="flex-1">
          <Input
            label="Nền tảng (%)"
            value={form.platform}
            onChangeText={(t) => setForm((f) => ({ ...f, platform: t.replace(/[^\d]/g, "") }))}
            keyboardType="number-pad"
          />
        </View>
      </View>
      {Number.isFinite(sum) ? (
        <Text className={`font-body text-xs ${sum === 100 ? "text-muted-foreground" : "text-warning"}`}>Tổng hiện tại: {sum}%</Text>
      ) : null}
    </View>
  );
}
