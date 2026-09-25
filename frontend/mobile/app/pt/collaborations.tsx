import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Handshake, Repeat, X } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Stagger,
  StaggerItem,
  useToast,
} from "../../src/components/ui";
import { SelectField } from "../../src/components/SelectSheet";
import { collaborationService, gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { shortDate } from "../../src/features/wallet/wallet";
import {
  MIN_PLATFORM_RATE,
  canRespondToCollab,
  collabStatus,
  ratePercent,
  ratesError,
  ratesPayload,
} from "../../src/features/pt/pt";

type RateForm = { pt: string; gym: string; platform: string; note: string };
const DEFAULT_RATES: RateForm = { pt: "60", gym: "30", platform: "10", note: "" };

/**
 * PT-13 — "Hợp tác phòng gym". Web nests `CollaborationPanel as="PT"` inside PTProfilePage; on a
 * phone it is its own screen off the profile hub.
 *
 * The three shares are the revenue split that lands on every contract signed under the
 * partnership. gym-service refuses a table that does not sum to exactly 1 with the platform at or
 * above its floor (`validateRates`), so the form checks the same rule before sending — see
 * `ratesError`. The rates are a TEMPLATE: the schema notes a signed contract copies them onto
 * itself, so renegotiating later does not move money on contracts already running, and the screen
 * says that rather than implying otherwise.
 *
 * Whose turn it is comes from `proposedBy`, not from the status — see `collabStatus`.
 */
export default function PtCollaborationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [proposeOpen, setProposeOpen] = useState(false);
  const [gymId, setGymId] = useState("");
  const [form, setForm] = useState<RateForm>(DEFAULT_RATES);
  const [respondTo, setRespondTo] = useState<any>(null);
  const [counter, setCounter] = useState<RateForm>(DEFAULT_RATES);

  const query = useQuery({ queryKey: ["pt-collaborations", uid], queryFn: () => collaborationService.listMine() });
  const rows: any[] = Array.isArray(query.data) ? query.data : [];
  const gymsQuery = useQuery({ queryKey: ["all-gyms"], queryFn: () => gymService.listGyms(), staleTime: 5 * 60_000 });
  const gyms: any[] = Array.isArray(gymsQuery.data) ? gymsQuery.data : [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pt-collaborations", uid] });
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const propose = useMutation({
    mutationFn: () =>
      collaborationService.proposeAsPt(gymId, {
        ...ratesPayload(form.pt, form.gym, form.platform),
        note: form.note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.show("Đã gửi đề nghị hợp tác", "success");
      setProposeOpen(false);
      setForm(DEFAULT_RATES);
      setGymId("");
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được đề nghị"),
  });

  const respond = useMutation({
    mutationFn: (action: "ACCEPT" | "REJECT" | "COUNTER") =>
      collaborationService.respond(respondTo.id, "PT", {
        action,
        ...(action === "COUNTER"
          ? { ...ratesPayload(counter.pt, counter.gym, counter.platform), note: counter.note.trim() || undefined }
          : {}),
      }),
    onSuccess: (_d, action) => {
      toast.show(
        action === "ACCEPT" ? "Đã nhận hợp tác" : action === "REJECT" ? "Đã từ chối" : "Đã gửi tỷ lệ đề nghị lại",
        "success",
      );
      setRespondTo(null);
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được phản hồi"),
  });

  const terminate = useMutation({
    mutationFn: (id: string) => collaborationService.terminate(id, "PT"),
    onSuccess: () => {
      toast.show("Đã chấm dứt hợp tác", "success");
      invalidate();
    },
    onError: (e) => fail(e, "Không chấm dứt được hợp tác"),
  });

  const askTerminate = (row: any) =>
    Alert.alert(
      "Chấm dứt hợp tác?",
      "Hợp đồng đang chạy vẫn giữ nguyên tỷ lệ đã thoả thuận; chỉ hợp đồng mới là không còn áp dụng.",
      [
        { text: "Không", style: "cancel" },
        { text: "Chấm dứt", style: "destructive", onPress: () => terminate.mutate(row.id) },
      ],
    );

  const gymName = (row: any) =>
    row?.gym?.name ?? gyms.find((g) => g.id === row?.gymId)?.name ?? "Phòng gym";

  const proposeError = gymId ? ratesError(form.pt, form.gym, form.platform) : "Chọn phòng gym muốn hợp tác.";
  const counterError = ratesError(counter.pt, counter.gym, counter.platform);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/profile"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Hợp tác phòng gym" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <Card className="mb-4 flex-row items-start gap-2.5 p-4">
          <Handshake size={17} color={accent.primary} />
          <Text className="flex-1 font-body text-sm leading-5 text-muted-foreground">
            Hợp tác là thoả thuận chia doanh thu với một phòng gym. Tỷ lệ ở đây là{" "}
            <Text className="font-body-semibold text-foreground">bản mẫu</Text> — hợp đồng đã ký giữ nguyên tỷ lệ lúc ký.
          </Text>
        </Card>

        <Button full icon={Handshake} className="mb-4" onPress={() => setProposeOpen(true)}>
          Đề nghị hợp tác
        </Button>

        {query.isLoading ? (
          <ActivityIndicator className="mt-6" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được danh sách hợp tác. Kéo xuống để thử lại.</Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Chưa có hợp tác nào"
            description="Đề nghị hợp tác với một phòng gym để nhận học viên tại đó."
          />
        ) : (
          <Stagger className="gap-3">
            {rows.map((row) => {
              const st = collabStatus(row);
              const mine = canRespondToCollab(row);
              return (
                <StaggerItem key={row.id}>
                  <Card className="gap-3 p-4">
                    <View className="flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                        <Building2 size={18} color={designTokens.mutedForeground} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {gymName(row)}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground">
                          Vòng {row.round ?? 1}
                          {row.expiresAt ? ` · hạn trả lời ${shortDate(row.expiresAt)}` : ""}
                        </Text>
                      </View>
                      <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
                    </View>

                    <View className="flex-row gap-2 rounded-xl bg-panel px-3.5 py-2.5">
                      <Share label="Bạn" value={ratePercent(row.proposedPtRate)} highlight />
                      <Share label="Phòng gym" value={ratePercent(row.proposedGymRate)} />
                      <Share label="Nền tảng" value={ratePercent(row.platformRate)} />
                    </View>

                    {mine ? (
                      <Button
                        size="sm"
                        onPress={() => {
                          setRespondTo(row);
                          setCounter({
                            pt: String(Math.round(Number(row.proposedPtRate ?? 0.6) * 100)),
                            gym: String(Math.round(Number(row.proposedGymRate ?? 0.3) * 100)),
                            platform: String(Math.round(Number(row.platformRate ?? 0.1) * 100)),
                            note: "",
                          });
                        }}
                      >
                        Trả lời đề nghị
                      </Button>
                    ) : row.status === "ACCEPTED" ? (
                      <Button size="sm" variant="ghost" disabled={terminate.isPending} onPress={() => askTerminate(row)}>
                        Chấm dứt hợp tác
                      </Button>
                    ) : null}
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>

      <BottomSheet open={proposeOpen} onClose={() => setProposeOpen(false)} title="Đề nghị hợp tác">
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <SelectField
              label="Phòng gym *"
              value={gymId}
              options={gyms.map((g: any) => ({ value: g.id, label: g.name }))}
              loading={gymsQuery.isLoading}
              onChange={setGymId}
            />
            <RateFields form={form} setForm={setForm} />
            <Input label="Lời nhắn" value={form.note} onChangeText={(t) => setForm((f) => ({ ...f, note: t }))} placeholder="Tôi muốn nhận học viên tại chi nhánh này…" multiline />
            {proposeError ? <Text className="font-body text-xs text-destructive">{proposeError}</Text> : null}
            <Button full disabled={!!proposeError || propose.isPending} onPress={() => propose.mutate()}>
              {propose.isPending ? "Đang gửi…" : "Gửi đề nghị"}
            </Button>
          </View>
        </ScrollView>
      </BottomSheet>

      <BottomSheet open={!!respondTo} onClose={() => setRespondTo(null)} title="Trả lời đề nghị">
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <Text className="font-body text-sm text-muted-foreground">
              Phòng gym đề nghị: bạn {ratePercent(respondTo?.proposedPtRate)} · phòng gym{" "}
              {ratePercent(respondTo?.proposedGymRate)} · nền tảng {ratePercent(respondTo?.platformRate)}.
            </Text>
            <View className="flex-row gap-2">
              <Button
                icon={Check}
                className="flex-1"
                disabled={respond.isPending}
                onPress={() => respond.mutate("ACCEPT")}
              >
                Đồng ý
              </Button>
              <Button
                variant="secondary"
                icon={X}
                className="flex-1"
                disabled={respond.isPending}
                onPress={() => respond.mutate("REJECT")}
              >
                Từ chối
              </Button>
            </View>
            <View className="mt-1 border-t border-border pt-3">
              <Text className="mb-2 font-body-semibold text-sm text-foreground">Hoặc đề nghị tỷ lệ khác</Text>
              <RateFields form={counter} setForm={setCounter} />
              <View className="mt-3">
                <Input label="Lời nhắn" value={counter.note} onChangeText={(t) => setCounter((f) => ({ ...f, note: t }))} multiline />
              </View>
              {counterError ? <Text className="mt-2 font-body text-xs text-destructive">{counterError}</Text> : null}
              <Button
                full
                variant="secondary"
                icon={Repeat}
                className="mt-3"
                disabled={!!counterError || respond.isPending}
                onPress={() => respond.mutate("COUNTER")}
              >
                Gửi tỷ lệ đề nghị lại
              </Button>
            </View>
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function RateFields({ form, setForm }: { form: RateForm; setForm: (f: (p: RateForm) => RateForm) => void }) {
  const sum = Number(form.pt) + Number(form.gym) + Number(form.platform);
  return (
    <View className="gap-2">
      <Text className="font-body text-xs text-muted-foreground">
        Chia doanh thu theo phần trăm — ba ô phải cộng đúng 100%, phần nền tảng tối thiểu{" "}
        {MIN_PLATFORM_RATE * 100}%.
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
        <Text className={`font-body text-xs ${sum === 100 ? "text-muted-foreground" : "text-warning"}`}>
          Tổng hiện tại: {sum}%
        </Text>
      ) : null}
    </View>
  );
}

function Share({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View className="flex-1 items-center">
      <Text className={`font-display text-sm ${highlight ? "text-primary" : "text-foreground"}`}>{value}</Text>
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}
