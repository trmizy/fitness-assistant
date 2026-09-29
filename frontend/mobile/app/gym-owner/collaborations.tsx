import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Handshake, Repeat, UserRound, X } from "lucide-react-native";

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
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { SelectField } from "../../src/components/SelectSheet";
import { collaborationService, gymService, profileService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { shortDate } from "../../src/features/wallet/wallet";
import { normalizePt } from "../../src/features/services/ptDiscovery";
import {
  MIN_PLATFORM_RATE,
  canTerminateCollab,
  ratePercent,
  ratesError,
  ratesPayload,
  type CollabRow,
} from "../../src/features/collaboration/collaboration";
import {
  branchName,
  canRespondAsGym,
  collabRows,
  gymCollabStatus,
  isBrandOwner,
  ownedGyms,
  sortCollabsForOwner,
} from "../../src/features/gymOwner/gymOwner";

type RateForm = { pt: string; gym: string; platform: string; note: string };
const DEFAULT_RATES: RateForm = { pt: "60", gym: "30", platform: "10", note: "" };

/**
 * GY-06 — "Hợp tác huấn luyện viên", nhìn từ ghế CHỦ GYM. Cùng một dữ liệu, cùng một bảng trạng thái
 * với màn của huấn luyện viên (Phase 11) — chỉ khác phía đang nhìn, và phía đó là tham số của
 * `collabStatusFor`, nên hai màn không thể nói ngược nhau.
 *
 * Danh sách gộp mọi chi nhánh (`GET /owner/collaborations` không lọc theo gym), nhưng **mời** thì
 * phải chọn đúng một chi nhánh: hợp tác là "làm việc tại địa điểm này", không phải một thoả thuận
 * cấp thương hiệu.
 *
 * Khác web một chỗ có chủ ý: web bắt chủ gym **gõ tay UUID của huấn luyện viên**. Trên điện thoại
 * đó là việc không làm nổi, nên ở đây chọn từ danh bạ huấn luyện viên công khai
 * (`GET /profile/pts`) — cùng nguồn mà màn tìm PT của khách đang dùng.
 */
export default function GymOwnerCollaborationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [gymId, setGymId] = useState("");
  const [ptUserId, setPtUserId] = useState("");
  const [form, setForm] = useState<RateForm>(DEFAULT_RATES);
  const [respondTo, setRespondTo] = useState<CollabRow | null>(null);
  const [counter, setCounter] = useState<RateForm>(DEFAULT_RATES);

  const query = useQuery({ queryKey: ["owner-collaborations", uid], queryFn: () => collaborationService.listForOwner() });
  const rows = sortCollabsForOwner(collabRows(query.data));

  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const gyms = ownedGyms(gymsQuery.data);
  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const isOwner = isBrandOwner(statusQuery.data);

  const ptsQuery = useQuery({
    queryKey: ["pt-directory"],
    queryFn: () => profileService.listPTs(),
    staleTime: 5 * 60_000,
  });
  const pts = useMemo(() => {
    const raw = ptsQuery.data as any;
    const list = Array.isArray(raw) ? raw : (raw?.data ?? raw?.pts ?? []);
    return (Array.isArray(list) ? list : []).map(normalizePt).filter((p) => p.userId);
  }, [ptsQuery.data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["owner-collaborations", uid] });
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const invite = useMutation({
    mutationFn: () =>
      collaborationService.proposeAsGym(gymId, {
        ptUserId,
        ...ratesPayload(form.pt, form.gym, form.platform),
        note: form.note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.show("Đã gửi lời mời hợp tác", "success");
      setInviteOpen(false);
      setForm(DEFAULT_RATES);
      setPtUserId("");
      invalidate();
    },
    onError: (e) => fail(e, "Không gửi được lời mời"),
  });

  const respond = useMutation({
    mutationFn: (action: "ACCEPT" | "REJECT" | "COUNTER") =>
      collaborationService.respond(respondTo!.id, "GYM", {
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
    mutationFn: (id: string) => collaborationService.terminate(id, "GYM"),
    onSuccess: () => {
      toast.show("Đã chấm dứt hợp tác", "success");
      invalidate();
    },
    onError: (e) => fail(e, "Không chấm dứt được hợp tác"),
  });

  const askTerminate = (row: CollabRow) =>
    Alert.alert(
      "Chấm dứt hợp tác?",
      "Hợp đồng đang chạy vẫn giữ nguyên tỷ lệ đã thoả thuận; chỉ hợp đồng mới là không còn áp dụng.",
      [
        { text: "Không", style: "cancel" },
        { text: "Chấm dứt", style: "destructive", onPress: () => terminate.mutate(row.id) },
      ],
    );

  /**
   * Dòng hợp tác chỉ mang `ptUserId`, không có tên. Tra tên từ danh bạ huấn luyện viên công khai;
   * ai không có trong danh bạ thì hiện mã rút gọn — KHÔNG hiện chung một chữ "Huấn luyện viên" cho
   * mọi dòng, vì như thế chủ gym không phân biệt được ai với ai.
   */
  const ptLabel = (row: CollabRow) => {
    const found = pts.find((p) => p.userId === row.ptUserId)?.name;
    if (found) return found;
    const id = (row.ptUserId ?? "").trim();
    return id ? `Huấn luyện viên #${id.slice(0, 8)}` : "Huấn luyện viên";
  };
  const gymLabel = (row: CollabRow) => {
    const g = gyms.find((x) => x.id === row.gymId);
    return g ? branchName(g) : (row.gym?.name ?? "Chi nhánh");
  };

  const inviteError = !gymId
    ? "Chọn chi nhánh mời huấn luyện viên về."
    : !ptUserId
      ? "Chọn huấn luyện viên."
      : ratesError(form.pt, form.gym, form.platform);
  const counterError = ratesError(counter.pt, counter.gym, counter.platform);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-owner/dashboard"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Hợp tác huấn luyện viên" onBack={back} />
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
            Hợp tác là thoả thuận chia doanh thu với một huấn luyện viên tại một chi nhánh. Tỷ lệ ở đây là{" "}
            <Text className="font-body-semibold text-foreground">bản mẫu</Text> — hợp đồng đã ký giữ nguyên tỷ lệ
            lúc ký.
          </Text>
        </Card>

        {isOwner ? (
          <Button
            full
            icon={Handshake}
            className="mb-4"
            disabled={gyms.length === 0}
            onPress={() => {
              setForm(DEFAULT_RATES);
              setPtUserId("");
              if (!gymId && gyms[0]) setGymId(gyms[0].id);
              setInviteOpen(true);
            }}
          >
            Mời huấn luyện viên
          </Button>
        ) : null}

        {query.isLoading ? (
          <ActivityIndicator className="mt-6" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">
            Không tải được danh sách hợp tác. Kéo xuống để thử lại.
          </Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="Chưa có hợp tác nào"
            description="Mời một huấn luyện viên về chi nhánh để họ nhận học viên tại đó."
          />
        ) : (
          <Stagger className="gap-3">
            {rows.map((row) => {
              const st = gymCollabStatus(row);
              const mine = canRespondAsGym(row);
              return (
                <StaggerItem key={row.id}>
                  <Card className="gap-3 p-4">
                    <View className="flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                        <UserRound size={18} color={designTokens.mutedForeground} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {ptLabel(row)}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                          {gymLabel(row)} · vòng {row.round ?? 1}
                          {row.expiresAt ? ` · hạn ${shortDate(row.expiresAt)}` : ""}
                        </Text>
                      </View>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </View>

                    <View className="flex-row gap-2 rounded-xl bg-panel px-3.5 py-2.5">
                      <Share label="Huấn luyện viên" value={ratePercent(row.proposedPtRate)} />
                      <Share label="Bạn" value={ratePercent(row.proposedGymRate)} highlight />
                      <Share label="Nền tảng" value={ratePercent(row.platformRate)} />
                    </View>

                    {row.note ? (
                      <Text className="font-body text-xs italic text-muted-foreground">“{row.note}”</Text>
                    ) : null}

                    {mine ? (
                      <View className="flex-row gap-2">
                        <Button
                          className="flex-1"
                          size="sm"
                          icon={Check}
                          onPress={() => {
                            setRespondTo(row);
                            setCounter({
                              pt: String(Math.round(Number(row.proposedPtRate ?? 0) * 100)),
                              gym: String(Math.round(Number(row.proposedGymRate ?? 0) * 100)),
                              platform: String(Math.round(Number(row.platformRate ?? 0) * 100)),
                              note: "",
                            });
                          }}
                        >
                          Trả lời
                        </Button>
                      </View>
                    ) : null}

                    {isOwner && canTerminateCollab(row) ? (
                      <Tappable
                        accessibilityLabel="Chấm dứt hợp tác"
                        hitSlop={8}
                        onPress={() => askTerminate(row)}
                        className="self-start"
                      >
                        <Text className="font-body-semibold text-xs text-destructive">Chấm dứt hợp tác</Text>
                      </Tappable>
                    ) : null}
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>

      {/* Mời huấn luyện viên */}
      <BottomSheet open={inviteOpen} onClose={() => setInviteOpen(false)} title="Mời huấn luyện viên">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <SelectField
            label="Chi nhánh"
            value={gymId}
            options={gyms.map((g) => ({ value: g.id, label: branchName(g) }))}
            onChange={setGymId}
          />
          <SelectField
            label="Huấn luyện viên"
            value={ptUserId}
            options={pts.map((p) => ({ value: p.userId, label: p.name }))}
            loading={ptsQuery.isLoading}
            onChange={setPtUserId}
            allowClear
          />
          <RateFields form={form} setForm={setForm} />
          <Button disabled={!!inviteError || invite.isPending} onPress={() => invite.mutate()}>
            {invite.isPending ? "Đang gửi…" : "Gửi lời mời"}
          </Button>
          {inviteError ? (
            <Text className="text-center font-body text-xs text-muted-foreground">{inviteError}</Text>
          ) : null}
        </ScrollView>
      </BottomSheet>

      {/* Trả lời một đề nghị */}
      <BottomSheet open={!!respondTo} onClose={() => setRespondTo(null)} title="Trả lời đề nghị">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Text className="font-body text-sm text-muted-foreground">
            {respondTo ? `${ptLabel(respondTo)} · ${gymLabel(respondTo)}` : ""}
          </Text>
          <View className="flex-row gap-2">
            <Button className="flex-1" icon={Check} disabled={respond.isPending} onPress={() => respond.mutate("ACCEPT")}>
              Đồng ý
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              icon={X}
              disabled={respond.isPending}
              onPress={() => respond.mutate("REJECT")}
            >
              Từ chối
            </Button>
          </View>

          <View className="gap-3 border-t border-border pt-3">
            <Text className="font-body-semibold text-sm text-foreground">Hoặc đề nghị lại tỷ lệ khác</Text>
            <RateFields form={counter} setForm={setCounter} />
            <Button
              variant="secondary"
              icon={Repeat}
              disabled={!!counterError || respond.isPending}
              onPress={() => respond.mutate("COUNTER")}
            >
              Gửi tỷ lệ đề nghị lại
            </Button>
            {counterError ? (
              <Text className="text-center font-body text-xs text-muted-foreground">{counterError}</Text>
            ) : null}
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function Share({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View className="flex-1">
      <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text className={`font-body-semibold text-sm ${highlight ? "text-primary" : "text-foreground"}`}>{value}</Text>
    </View>
  );
}

function RateFields({ form, setForm }: { form: RateForm; setForm: (f: RateForm | ((p: RateForm) => RateForm)) => void }) {
  const only = (v: string) => v.replace(/[^\d]/g, "");
  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <Input
          className="flex-1"
          label="HLV (%)"
          value={form.pt}
          onChangeText={(v) => setForm((f) => ({ ...f, pt: only(v) }))}
          keyboardType="number-pad"
          placeholderTextColor={inputPlaceholderColor}
        />
        <Input
          className="flex-1"
          label="Bạn (%)"
          value={form.gym}
          onChangeText={(v) => setForm((f) => ({ ...f, gym: only(v) }))}
          keyboardType="number-pad"
          placeholderTextColor={inputPlaceholderColor}
        />
        <Input
          className="flex-1"
          label="Nền tảng (%)"
          value={form.platform}
          onChangeText={(v) => setForm((f) => ({ ...f, platform: only(v) }))}
          keyboardType="number-pad"
          placeholderTextColor={inputPlaceholderColor}
        />
      </View>
      <Text className="font-body text-[11px] text-muted-foreground">
        Ba tỷ lệ phải cộng đúng 100%, phần nền tảng không dưới {MIN_PLATFORM_RATE * 100}%.
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
