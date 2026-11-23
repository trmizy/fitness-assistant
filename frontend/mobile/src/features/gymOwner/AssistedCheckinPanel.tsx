import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, Mail, Search, ShieldCheck, Square, SquareCheck, UserCheck, X } from "lucide-react-native";

import { Avatar, Badge, BottomSheet, Button, Card, Input, Segmented, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { InlineRefusal } from "../services/InlineRefusal";
import { useStaffPermissions } from "./useStaffPermissions";
import { PENDING_EXCEPTION_COUNT_KEY } from "./usePendingCheckinExceptionCount";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import { designTokens } from "../../theme/colors";
import {
  DECISION_TEXT,
  EXCEPTION_STATUS_LABEL,
  MEMBER_STATUS_LABEL,
  REASON_MAX,
  REASON_MIN,
  REASON_PRESETS,
  assistedErrorCode,
  assistedErrorText,
  blockedText,
  canConfirm,
  canDecideRow,
  clockLabel,
  decisionRefusal,
  decisionTitle,
  formatCodeInput,
  formatExpiry,
  formatLast4,
  isFullCode,
  newRequestId,
  normalizeConfig,
  normalizeExceptions,
  normalizeMembers,
  planTypeLabel,
  reasonCounter,
  reasonProblem,
  type AssistedMethod,
  type DecisionRefusal,
  type DecisionVerb,
  type ExceptionRow,
  type MemberResult,
} from "./frontDesk";

/**
 * N15M-08 — "Check-in hộ hội viên" at the front desk (web: `AssistedCheckinPanel`, D15c). For a member who cannot
 * scan the QR (forgot the phone, flat battery). Flow: look the member up → pick → choose how to verify identity →
 * confirm. A name or a phone number alone is never enough; the server re-checks everything (plan, brand, visits,
 * duplicate scan, OTP, photo, exception) and writes an audit row — this screen only guides.
 */
const LOOKUP_MODES = ["Mã hội viên", "Tên + 4 ký tự cuối"] as const;

export function AssistedCheckinPanel({ gymId }: { gymId: string }) {
  const { user } = useApp();
  const accent = useWorkspaceAccent();
  const uid = user?.id ?? "guest";
  const qc = useQueryClient();

  const configQ = useQuery({
    queryKey: ["frontdesk-assisted-config", uid, gymId],
    queryFn: async () => normalizeConfig(await gymService.getAssistedConfig(gymId)),
    enabled: !!gymId,
  });
  const autoMethods = configQ.data?.methods ?? [];

  // ── lookup ──
  const [mode, setMode] = useState<(typeof LOOKUP_MODES)[number]>("Mã hội viên");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [results, setResults] = useState<MemberResult[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<MemberResult | null>(null);
  const [done, setDone] = useState<{ displayName: string; remainingVisits: number | null; replayed: boolean } | null>(null);

  // Another branch or another account → drop every trace of the previous shift's member.
  useEffect(() => {
    setResults(null);
    setSelected(null);
    setDone(null);
    setCode("");
    setName("");
    setLast4("");
    setSearchError("");
  }, [gymId, uid]);

  const byCode = mode === "Mã hội viên";
  const canSearch = byCode ? isFullCode(code) : name.trim().length >= 2 && last4.length === 4;
  const search = useMutation({
    mutationFn: async () =>
      normalizeMembers(await gymService.searchFrontDeskMembers(gymId, byCode ? { code } : { name: name.trim(), last4 })),
    onSuccess: (rows) => {
      setResults(rows);
      setSearchError("");
    },
    onError: (e) => {
      setResults(null);
      setSearchError(assistedErrorText(e));
    },
  });

  // ── verify + confirm ──
  const [method, setMethod] = useState<AssistedMethod>("PHOTO_MATCH");
  const [preset, setPreset] = useState<string>(REASON_PRESETS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [photoAttested, setPhotoAttested] = useState(false);
  const [statedCode, setStatedCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [otp, setOtp] = useState("");
  const [excReason, setExcReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const reason = preset === "OTHER" ? otherReason.trim() : preset;

  useEffect(() => {
    if (!selected) return;
    setActionError("");
    setNotice("");
    setPhotoAttested(false);
    setStatedCode("");
    setChallengeId(null);
    setOtp("");
    setExcReason("");
    setResendAt(0);
    setPreset(REASON_PRESETS[0]);
    setOtherReason("");
    const first: AssistedMethod | undefined =
      selected.hasPhoto && autoMethods.includes("PHOTO_MATCH")
        ? "PHOTO_MATCH"
        : autoMethods.includes("MEMBER_OTP")
          ? "MEMBER_OTP"
          : undefined;
    setMethod(first ?? "MANAGER_EXCEPTION");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.membershipId]);

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [resendAt]);
  const resendLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const exceptionsQ = useQuery({
    queryKey: ["frontdesk-exceptions", uid, gymId],
    queryFn: async () => normalizeExceptions(await gymService.listCheckinExceptions(gymId)),
    enabled: !!gymId && !!selected && method === "MANAGER_EXCEPTION",
    refetchInterval: 8000,
  });
  const approvedException = exceptionsQ.data?.exceptions.find(
    (e) => selected && e.membershipId === selected.membershipId && e.status === "APPROVED",
  );
  const pendingException = exceptionsQ.data?.exceptions.find(
    (e) => selected && e.membershipId === selected.membershipId && e.status === "PENDING",
  );

  const sendOtp = useMutation({
    mutationFn: async () => gymService.requestAssistedOtp(gymId, selected!.membershipId),
    onSuccess: (r: { challengeId: string; resendAfterSeconds?: number }) => {
      setChallengeId(r.challengeId);
      setOtp("");
      setActionError("");
      setNotice("Đã gửi mã tới e-mail đăng ký của hội viên. Nhờ hội viên đọc mã gồm 6 chữ số.");
      setResendAt(Date.now() + (r.resendAfterSeconds ?? configQ.data?.otpResendSeconds ?? 60) * 1000);
      setNow(Date.now());
    },
    onError: (e) => {
      setNotice("");
      setActionError(assistedErrorText(e));
    },
  });

  const requestExc = useMutation({
    mutationFn: async () => gymService.requestCheckinException(gymId, { membershipId: selected!.membershipId, reason: excReason.trim() }),
    onSuccess: () => {
      setActionError("");
      setNotice("Đã gửi yêu cầu. Chờ quản lý hoặc chủ chi nhánh duyệt, sau đó quay lại bấm Xác nhận.");
      void qc.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] });
    },
    onError: (e) => {
      setNotice("");
      setActionError(assistedErrorText(e));
    },
  });

  // Same content (double tap, flaky network resend) → same key → the server replays instead of checking in twice.
  const payloadKey = JSON.stringify([selected?.membershipId, method, reason, photoAttested, statedCode, challengeId, otp, approvedException?.id]);
  const requestId = useMemo(() => newRequestId(), [payloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmEnabled =
    !!selected && canConfirm({ method, reason, photoAttested, statedCode, otp, challengeId, exceptionId: approvedException?.id ?? null });
  const confirm = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { requestId, membershipId: selected!.membershipId, method, reason };
      if (method === "PHOTO_MATCH") Object.assign(body, { photoMatchAttested: photoAttested, statedMemberCode: statedCode });
      if (method === "MEMBER_OTP") Object.assign(body, { challengeId, otp });
      if (method === "MANAGER_EXCEPTION") Object.assign(body, { exceptionId: approvedException?.id });
      return gymService.assistedCheckIn(gymId, body);
    },
    onSuccess: (r: { displayName?: string; remainingVisits?: number | null; replayed?: boolean }) => {
      setDone({
        displayName: r.displayName ?? selected?.displayName ?? "Hội viên",
        remainingVisits: r.remainingVisits ?? null,
        replayed: r.replayed === true,
      });
      setSelected(null);
      setResults(null);
      setCode("");
      setName("");
      setLast4("");
      void qc.invalidateQueries({ queryKey: ["gym-checkins", gymId] });
      void qc.invalidateQueries({ queryKey: ["frontdesk-today", uid, gymId] });
      void qc.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] });
    },
    onError: (e) => {
      setNotice("");
      setActionError(assistedErrorText(e));
      const c = assistedErrorCode(e);
      if (c === "OTP_ATTEMPTS_EXCEEDED" || c === "OTP_EXPIRED") setChallengeId(null);
    },
  });

  const methodChoice = (m: AssistedMethod, label: string, hint: string, disabled: boolean, why?: string) => (
    <Tappable
      key={m}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        setMethod(m);
        setActionError("");
        setNotice("");
      }}
      className={`min-h-[56px] justify-center rounded-xl border px-3.5 py-2.5 ${
        method === m ? "border-primary bg-primary/10" : "border-border bg-panel"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <Text className="font-body-semibold text-sm text-foreground">{label}</Text>
      <Text className="font-body text-[11px] leading-4 text-muted-foreground">{disabled && why ? why : hint}</Text>
    </Tappable>
  );

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <ShieldCheck size={16} color={accent.primary} />
        <Text className="font-body-semibold text-sm text-foreground">Check-in hộ hội viên</Text>
      </View>
      <Text className="font-body text-[11px] leading-4 text-muted-foreground">
        Dùng khi hội viên không quét được QR (quên điện thoại, hết pin). Phải xác minh danh tính trước khi check-in; mọi bước đều được ghi lại.
      </Text>

      {done ? (
        <View className="flex-row items-start gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3" accessibilityRole="alert">
          <CircleCheck size={18} color={accent.primary} />
          <View className="min-w-0 flex-1">
            <Text className="font-body-semibold text-sm text-primary">
              {done.replayed ? "Đã check-in từ trước" : "Đã check-in"} cho {done.displayName}
            </Text>
            {done.remainingVisits != null ? (
              <Text className="font-body text-xs text-muted-foreground">Còn {done.remainingVisits} buổi</Text>
            ) : null}
          </View>
          <Tappable accessibilityLabel="Đóng thông báo" onPress={() => setDone(null)} hitSlop={10}>
            <X size={16} color={designTokens.mutedForeground} />
          </Tappable>
        </View>
      ) : null}

      {!selected ? (
        <View className="gap-3">
          <Segmented
            options={[...LOOKUP_MODES]}
            value={mode}
            onChange={(v) => {
              setMode(v as (typeof LOOKUP_MODES)[number]);
              setSearchError("");
              setResults(null);
            }}
          />
          {byCode ? (
            <Input
              value={code}
              onChangeText={(v) => setCode(formatCodeInput(v))}
              placeholder="Mã hội viên (XXXX-XXXX)"
              placeholderTextColor={inputPlaceholderColor}
              accessibilityLabel="Mã hội viên"
              autoCapitalize="characters"
              autoCorrect={false}
            />
          ) : (
            <View className="flex-row gap-2">
              <Input
                className="flex-1"
                value={name}
                onChangeText={setName}
                placeholder="Đầu tên (vd: Nguyen)"
                placeholderTextColor={inputPlaceholderColor}
                accessibilityLabel="Tên hội viên"
                autoCorrect={false}
              />
              <Input
                className="w-28"
                value={last4}
                onChangeText={(v) => setLast4(formatLast4(v))}
                placeholder="4 cuối"
                placeholderTextColor={inputPlaceholderColor}
                accessibilityLabel="4 ký tự cuối của mã hội viên"
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
          )}
          <Text className="font-body text-[11px] leading-4 text-muted-foreground">
            Không tra được bằng tên hay số điện thoại một mình. Hội viên xem mã ở mục “Gói của tôi”.
          </Text>
          <Button icon={Search} disabled={!canSearch || search.isPending} onPress={() => search.mutate()}>
            {search.isPending ? "Đang tra cứu…" : "Tra cứu"}
          </Button>
          {searchError ? <Text className="font-body text-xs text-destructive">{searchError}</Text> : null}
          {results && results.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Không tìm thấy hội viên phù hợp ở thương hiệu này.</Text>
          ) : null}
          {results && results.length > 0 ? (
            <View className="gap-2">
              {results.map((m) => (
                <MemberCard
                  key={m.membershipId}
                  m={m}
                  onPick={() => {
                    setDone(null);
                    setSelected(m);
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View className="gap-3">
          <Tappable accessibilityLabel="Chọn người khác" onPress={() => setSelected(null)} className="min-h-10 flex-row items-center gap-1.5 self-start">
            <ArrowLeft size={15} color={designTokens.mutedForeground} />
            <Text className="font-body text-xs text-muted-foreground">Chọn người khác</Text>
          </Tappable>
          <MemberCard m={selected} large />

          <View className="gap-2">
            <Text className="font-body-semibold text-xs text-foreground">Lý do check-in hộ</Text>
            <View className="flex-row flex-wrap gap-2">
              {[...REASON_PRESETS, "OTHER"].map((r) => {
                const on = preset === r;
                return (
                  <Tappable
                    key={r}
                    accessibilityLabel={r === "OTHER" ? "Lý do khác" : r}
                    onPress={() => setPreset(r)}
                    className={`min-h-10 justify-center rounded-full border px-3.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
                  >
                    <Text className={`font-body-semibold text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>
                      {r === "OTHER" ? "Lý do khác…" : r}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
            {preset === "OTHER" ? (
              <Input
                value={otherReason}
                onChangeText={(v) => setOtherReason(v.slice(0, 200))}
                placeholder="Ghi rõ lý do"
                placeholderTextColor={inputPlaceholderColor}
              />
            ) : null}
          </View>

          <View className="gap-2">
            <Text className="font-body-semibold text-xs text-foreground">Cách xác minh danh tính</Text>
            {methodChoice(
              "PHOTO_MATCH",
              "Đối chiếu ảnh hồ sơ",
              "So khuôn mặt với ảnh hồ sơ và nhập mã hội viên do hội viên tự đọc",
              !autoMethods.includes("PHOTO_MATCH") || !selected.hasPhoto,
              !autoMethods.includes("PHOTO_MATCH") ? "Cách này đang tắt" : "Hội viên chưa có ảnh hồ sơ",
            )}
            {methodChoice(
              "MEMBER_OTP",
              "Mã gửi về e-mail hội viên",
              "Gửi mã 6 số tới e-mail đã đăng ký; hội viên đọc mã cho bạn",
              !autoMethods.includes("MEMBER_OTP"),
              "Cách này đang tắt",
            )}
            {methodChoice(
              "MANAGER_EXCEPTION",
              "Xin quản lý duyệt ngoại lệ",
              "Khi không dùng được hai cách trên; quản lý/chủ chi nhánh duyệt trong ngày",
              configQ.data?.exceptionEnabled === false,
              "Cách này đang tắt",
            )}
          </View>

          {method === "PHOTO_MATCH" ? (
            <View className="gap-3 rounded-xl bg-panel p-3">
              <Tappable
                accessibilityLabel="Xác nhận người trước mặt trùng với ảnh hồ sơ"
                onPress={() => setPhotoAttested((v) => !v)}
                className="min-h-10 flex-row items-start gap-2.5"
              >
                {photoAttested ? <SquareCheck size={20} color={accent.primary} /> : <Square size={20} color={designTokens.mutedForeground} />}
                <Text className="min-w-0 flex-1 font-body text-sm text-foreground">
                  Tôi xác nhận người trước mặt trùng với ảnh hồ sơ ở trên.
                </Text>
              </Tappable>
              <Input
                value={statedCode}
                onChangeText={(v) => setStatedCode(formatCodeInput(v))}
                placeholder="Mã hội viên do hội viên đọc"
                placeholderTextColor={inputPlaceholderColor}
                accessibilityLabel="Mã hội viên do hội viên đọc"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Text className="font-body text-[11px] text-muted-foreground">Hãy để hội viên tự đọc mã của mình, đừng đọc hộ.</Text>
            </View>
          ) : null}

          {method === "MEMBER_OTP" ? (
            <View className="gap-3 rounded-xl bg-panel p-3">
              <Button
                variant="secondary"
                icon={Mail}
                disabled={sendOtp.isPending || resendLeft > 0}
                onPress={() => sendOtp.mutate()}
              >
                {sendOtp.isPending
                  ? "Đang gửi…"
                  : challengeId
                    ? resendLeft > 0
                      ? `Gửi lại mã sau ${resendLeft}s`
                      : "Gửi lại mã"
                    : "Gửi mã tới e-mail hội viên"}
              </Button>
              {challengeId ? (
                <Input
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Mã 6 chữ số"
                  placeholderTextColor={inputPlaceholderColor}
                  accessibilityLabel="Mã xác minh 6 chữ số"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                />
              ) : null}
              <Text className="font-body text-[11px] text-muted-foreground">
                Mã chỉ dùng một lần và hết hạn sau {Math.round((configQ.data?.otpTtlSeconds ?? 300) / 60)} phút.
              </Text>
            </View>
          ) : null}

          {method === "MANAGER_EXCEPTION" ? (
            <View className="gap-3 rounded-xl bg-panel p-3">
              {approvedException ? (
                <Text className="font-body text-sm text-primary">
                  Quản lý đã duyệt: “{approvedException.decisionReason}”. Bấm Xác nhận để check-in.
                </Text>
              ) : pendingException ? (
                <Text className="font-body text-sm text-warning">Đang chờ quản lý duyệt… (tự cập nhật)</Text>
              ) : (
                <>
                  <Input
                    value={excReason}
                    onChangeText={(v) => setExcReason(v.slice(0, 300))}
                    placeholder="Vì sao không dùng được ảnh hay e-mail? (ít nhất 5 ký tự)"
                    placeholderTextColor={inputPlaceholderColor}
                    multiline
                    numberOfLines={3}
                  />
                  <Button
                    variant="secondary"
                    disabled={requestExc.isPending || excReason.trim().length < 5}
                    onPress={() => requestExc.mutate()}
                  >
                    {requestExc.isPending ? "Đang gửi…" : "Gửi yêu cầu cho quản lý"}
                  </Button>
                </>
              )}
              <Text className="font-body text-[11px] text-muted-foreground">Yêu cầu chỉ có hiệu lực trong ngày. Người xin không thể tự duyệt.</Text>
            </View>
          ) : null}

          {notice ? <Text className="font-body text-xs text-primary">{notice}</Text> : null}
          {actionError ? <Text className="font-body text-xs text-destructive">{actionError}</Text> : null}
          <Button icon={UserCheck} disabled={!confirmEnabled || confirm.isPending} onPress={() => confirm.mutate()}>
            {confirm.isPending ? "Đang check-in…" : "Xác nhận check-in"}
          </Button>
        </View>
      )}
    </Card>
  );
}

function MemberCard({ m, onPick, large }: { m: MemberResult; onPick?: () => void; large?: boolean }) {
  const st = MEMBER_STATUS_LABEL[m.status];
  return (
    <View className="gap-2 rounded-xl bg-panel p-3">
      <View className="flex-row items-start gap-3">
        <Avatar uri={m.photoUrl} name={m.displayName} size={large ? 72 : 48} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-start justify-between gap-2">
            <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground">{m.displayName}</Text>
            <Badge tone={st.tone}>{st.text}</Badge>
          </View>
          <Text className="font-body text-xs text-muted-foreground">
            Mã hội viên: <Text className="font-body-semibold text-foreground">{m.memberCode}</Text>
          </Text>
          <Text className="font-body text-xs text-muted-foreground">
            {m.planName} · {planTypeLabel(m)}
          </Text>
          <Text className="font-body text-xs text-muted-foreground">
            Hạn: {formatExpiry(m.expiresAt)}
            {m.remainingVisits != null ? ` · Còn ${m.remainingVisits} buổi` : ""}
          </Text>
          <Text className="font-body text-[11px] text-muted-foreground">Dùng được ở mọi chi nhánh của thương hiệu</Text>
          {!m.hasPhoto ? <Text className="font-body text-[11px] text-warning">Chưa có ảnh hồ sơ</Text> : null}
        </View>
      </View>
      {!m.canCheckIn ? <Text className="font-body text-xs text-destructive">{blockedText(m.blockedReason)}</Text> : null}
      {onPick ? (
        <Button size="sm" disabled={!m.canCheckIn} onPress={onPick}>
          Chọn hội viên này
        </Button>
      ) : null}
    </View>
  );
}

/**
 * Today's exception requests at this branch. A receptionist sees (and cannot decide) only her own. The owner and the manager
 * (`checkin.exception.approve`) can approve / reject a request made by someone else: tap Duyệt / Từ chối → a sheet that names the
 * member and the branch and asks for a reason (5-300, same as web) → the confirm button. The server stays the authority (role,
 * branch scope, four-eyes, end-of-day expiry, one decision per request); this only decides what to offer and says the refusals in
 * plain Vietnamese. The sheet is a native Modal, so a refusal is written INSIDE it (InlineRefusal), never as a root toast.
 */
export function CheckinExceptionsPanel({ gymId, gymName }: { gymId: string; gymName?: string }) {
  const { user } = useApp();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const uid = user?.id ?? "guest";
  const { can } = useStaffPermissions();
  const canApprovePermission = can("checkin.exception.approve");
  const q = useQuery({
    queryKey: ["frontdesk-exceptions", uid, gymId],
    queryFn: async () => normalizeExceptions(await gymService.listCheckinExceptions(gymId)),
    enabled: !!gymId,
    refetchInterval: 8000,
  });
  const [showDone, setShowDone] = useState(false);
  const [target, setTarget] = useState<{ row: ExceptionRow; verb: DecisionVerb } | null>(null);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<DecisionRefusal | null>(null);
  // Set synchronously on the first press: a second tap in the same frame cannot start a second request (isPending lags a render).
  const sending = useRef(false);
  // Another branch or another account → nothing typed or opened for the previous one survives.
  useEffect(() => {
    setShowDone(false);
    setTarget(null);
    setReason("");
    setRefusal(null);
    sending.current = false;
  }, [gymId, uid]);

  const refreshAfterDecision = () => {
    void qc.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] });
    void qc.invalidateQueries({ queryKey: [PENDING_EXCEPTION_COUNT_KEY, uid] });
  };

  const decide = useMutation({
    mutationFn: (v: { id: string; verb: DecisionVerb; reason: string }) => gymService.decideCheckinException(gymId, v.id, v.verb, v.reason),
    onSuccess: (_d, v) => {
      sending.current = false;
      toast.show(DECISION_TEXT[v.verb].success, "success");
      setTarget(null);
      setReason("");
      setRefusal(null);
      refreshAfterDecision();
    },
    onError: (e) => {
      sending.current = false;
      const r = decisionRefusal(e);
      setRefusal(r);
      if (r.reload) refreshAfterDecision();
    },
  });

  const openSheet = (row: ExceptionRow, verb: DecisionVerb) => {
    if (decide.isPending) return;
    setReason("");
    setRefusal(null);
    setTarget({ row, verb });
  };
  const closeSheet = () => {
    if (decide.isPending) return;
    setTarget(null);
    setRefusal(null);
  };
  const send = () => {
    if (!target || sending.current || decide.isPending || reasonProblem(reason)) return;
    sending.current = true;
    setRefusal(null);
    decide.mutate({ id: target.row.id, verb: target.verb, reason: reason.trim() });
  };

  if (q.isLoading) return <ActivityIndicator color={accent.primary} />;
  const data = q.data;
  if (!data || data.exceptions.length === 0) return null;
  const open = data.exceptions.filter((r) => r.status === "PENDING" || r.status === "APPROVED");
  const closed = data.exceptions.filter((r) => r.status !== "PENDING" && r.status !== "APPROVED");
  const rows: ExceptionRow[] = [...open, ...(showDone ? closed : [])];
  const nowMs = Date.now();
  const problem = reasonProblem(reason);
  const verbText = target ? DECISION_TEXT[target.verb] : null;
  // After a refusal that will not change (self-approval, already decided, no permission) the only sensible action is to close.
  const closeOnly = refusal !== null && !refusal.retry;

  return (
    <Card className="gap-3 p-4">
      <Text className="font-body-semibold text-sm text-foreground">
        {data.canApprove ? "Yêu cầu ngoại lệ hôm nay" : "Yêu cầu ngoại lệ của bạn"}
      </Text>
      {rows.map((r) => {
        const st = EXCEPTION_STATUS_LABEL[r.status];
        const decidable = canDecideRow({ canApprovePermission, listCanApprove: data.canApprove, row: r, nowMs });
        const waitingForOther = r.status === "PENDING" && canApprovePermission && data.canApprove && r.mine;
        return (
          <View key={r.id} className="gap-1 rounded-xl bg-panel p-3">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground">
                {r.displayName} <Text className="font-body text-xs text-muted-foreground">{r.memberCode}</Text>
              </Text>
              <Badge tone={st.tone}>{st.text}</Badge>
            </View>
            <Text className="font-body text-xs text-muted-foreground">
              {r.planName} · xin bởi {r.requestedByName}
              {r.createdAt ? ` lúc ${clockLabel(r.createdAt)}` : ""}
            </Text>
            <Text className="font-body text-xs text-foreground">Lý do: {r.requestReason}</Text>
            {r.decisionReason ? (
              <Text className="font-body text-xs text-muted-foreground">
                {r.decidedByName ?? "Quản lý"}: {r.decisionReason}
              </Text>
            ) : null}
            {decidable ? (
              <View className="mt-2 flex-row gap-2">
                <View className="min-w-0 flex-1">
                  <Button full variant="secondary" disabled={decide.isPending} onPress={() => openSheet(r, "reject")}>
                    Từ chối
                  </Button>
                </View>
                <View className="min-w-0 flex-1">
                  <Button full disabled={decide.isPending} onPress={() => openSheet(r, "approve")}>
                    Duyệt
                  </Button>
                </View>
              </View>
            ) : null}
            {waitingForOther ? (
              <Text className="mt-1 font-body text-[11px] text-muted-foreground">Yêu cầu do bạn tạo, cần người khác duyệt.</Text>
            ) : null}
          </View>
        );
      })}
      {closed.length > 0 ? (
        <Tappable accessibilityLabel="Hiện hoặc ẩn yêu cầu đã xử lý" onPress={() => setShowDone((v) => !v)} className="min-h-10 justify-center self-start">
          <Text className="font-body-semibold text-xs text-primary">
            {showDone ? "Ẩn yêu cầu đã xử lý" : `Xem ${closed.length} yêu cầu đã xử lý`}
          </Text>
        </Tappable>
      ) : null}

      <BottomSheet
        open={!!target && canApprovePermission && data.canApprove}
        onClose={closeSheet}
        title={target && verbText ? `${verbText.action} ngoại lệ check-in` : undefined}
      >
        {target && verbText ? (
          // Scrollable: with the keyboard open on a 360 x 640 phone the reason field + the confirm button must stay reachable.
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            <Text className="font-body-semibold text-sm text-foreground">
              {decisionTitle(target.verb, target.row.displayName, gymName || "chi nhánh này")}
            </Text>
            <View className="gap-0.5 rounded-xl bg-panel p-3">
              <Text className="font-body text-xs text-muted-foreground">
                {target.row.displayName}
                {target.row.memberCode ? ` · ${target.row.memberCode}` : ""} · xin bởi {target.row.requestedByName}
              </Text>
              <Text className="font-body text-xs text-foreground">Lý do xin: {target.row.requestReason}</Text>
            </View>
            <Text className="font-body text-xs leading-4 text-muted-foreground">{verbText.body}</Text>
            <Input
              label={`Lý do của bạn (${REASON_MIN} đến ${REASON_MAX} ký tự)`}
              value={reason}
              onChangeText={(v) => {
                setReason(v);
                if (refusal?.retry) setRefusal(null);
              }}
              placeholder={verbText.placeholder}
              placeholderTextColor={inputPlaceholderColor}
              accessibilityLabel="Lý do duyệt hoặc từ chối"
              multiline
              numberOfLines={3}
              editable={!decide.isPending}
            />
            <Text className="text-right font-body text-[11px] text-muted-foreground">{reasonCounter(reason)}</Text>
            {reason.trim().length > 0 && problem ? <Text className="font-body text-xs text-muted-foreground">{problem}</Text> : null}
            <InlineRefusal message={refusal?.text} testID="exception-decision-refusal" />
            {closeOnly ? (
              <Button variant="secondary" full onPress={closeSheet}>
                Đóng
              </Button>
            ) : (
              <Button
                full
                variant={target.verb === "reject" ? "destructive" : "primary"}
                disabled={!!problem || decide.isPending}
                onPress={send}
              >
                {decide.isPending ? verbText.doing : verbText.confirm}
              </Button>
            )}
          </ScrollView>
        ) : null}
      </BottomSheet>
    </Card>
  );
}
