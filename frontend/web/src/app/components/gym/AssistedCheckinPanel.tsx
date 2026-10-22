import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MagnifyingGlassIcon as Search, CircleNotchIcon as Loader2, CheckCircleIcon as CheckCircle, XIcon as X,
  ShieldCheckIcon as Shield, EnvelopeSimpleIcon as Mail, UserCircleIcon as UserCircle, ArrowLeftIcon as ArrowLeft,
} from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import {
  assistedErrorCode, assistedErrorText, blockedText, canConfirm, EXCEPTION_STATUS_LABEL, formatCodeInput, formatExpiry, initialsOf,
  isFullCode, newRequestId, normalizeConfig, normalizeExceptions, normalizeMembers, planTypeLabel, REASON_PRESETS, STATUS_LABEL,
  type AssistedMethod, type ExceptionRow, type MemberResult,
} from "../../utils/assistedCheckin";
import { clockLabel } from "../../utils/frontDeskToday";

/**
 * D15c — Check-in HỘ hội viên không dùng được QR (quên điện thoại, hết pin). Lễ tân / quản lý / chủ.
 *
 * Luồng: tra hội viên → chọn → chọn cách xác minh danh tính → xác nhận. Biết tên hay SĐT KHÔNG đủ. Máy chủ kiểm lại mọi thứ
 * (gói còn hạn, đúng thương hiệu, còn buổi, chống quét trùng, OTP, ảnh, ngoại lệ) — giao diện chỉ dẫn đường, không quyết định.
 * Chỉ hiện tập trường tối thiểu máy chủ trả về: không giá, thanh toán, sức khoẻ, SĐT, e-mail.
 */

const card = "bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3";
const input = "w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 min-w-0";
const primaryBtn = "px-4 py-2.5 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:hover:bg-green-500 text-black text-sm font-bold transition-all";
const ghostBtn = "px-3 py-2 rounded-lg border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800 text-xs font-semibold disabled:opacity-40";

function Avatar({ m, size = 48 }: { m: MemberResult; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (m.photoUrl && !broken) {
    return <img src={m.photoUrl} alt={`Ảnh hồ sơ của ${m.displayName}`} style={style} className="rounded-full object-cover flex-shrink-0 bg-zinc-800" onError={() => setBroken(true)} />;
  }
  return (
    <div style={style} className="rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-sm font-bold flex-shrink-0" aria-label="Chưa có ảnh hồ sơ">
      {initialsOf(m.displayName)}
    </div>
  );
}

function MemberCard({ m, onPick, large }: { m: MemberResult; onPick?: () => void; large?: boolean }) {
  const st = STATUS_LABEL[m.status];
  return (
    <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2" data-testid="member-result">
      <div className="flex items-start gap-3">
        <Avatar m={m} size={large ? 72 : 48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-zinc-100 break-words min-w-0">{m.displayName}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.text}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">Mã hội viên: <span className="font-mono font-bold text-zinc-200 tracking-wider">{m.memberCode}</span></p>
          <p className="text-xs text-zinc-500 break-words">{m.planName} · {planTypeLabel(m)}</p>
          <p className="text-xs text-zinc-500">
            Hạn: {formatExpiry(m.expiresAt)}
            {m.remainingVisits != null && <> · Còn <span className="text-zinc-300 font-semibold">{m.remainingVisits}</span> buổi</>}
          </p>
          <p className="text-[11px] text-zinc-600">Dùng được ở mọi chi nhánh của thương hiệu</p>
          {!m.hasPhoto && <p className="text-[11px] text-amber-400/80">Chưa có ảnh hồ sơ</p>}
        </div>
      </div>
      {!m.canCheckIn && <p className="text-xs text-red-400" data-testid="blocked-reason">{blockedText(m.blockedReason)}</p>}
      {onPick && (
        <button type="button" onClick={onPick} disabled={!m.canCheckIn} className={`${primaryBtn} w-full`}>
          Chọn hội viên này
        </button>
      )}
    </div>
  );
}

export function AssistedCheckinPanel({ gymId }: { gymId: string }) {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const qc = useQueryClient();

  const configQ = useQuery({
    queryKey: ["frontdesk-assisted-config", uid, gymId],
    queryFn: async () => normalizeConfig(await gymService.getAssistedConfig(gymId)),
    enabled: !!gymId,
  });
  const config = configQ.data;

  // ── tra cứu ──
  const [mode, setMode] = useState<"code" | "name">("code");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [results, setResults] = useState<MemberResult[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<MemberResult | null>(null);
  const [done, setDone] = useState<{ displayName: string; remainingVisits: number | null; replayed: boolean } | null>(null);

  // Đổi chi nhánh hoặc tài khoản → bỏ sạch trạng thái cũ (không để dữ liệu hội viên của ca trước nằm lại).
  useEffect(() => {
    setResults(null); setSelected(null); setDone(null); setCode(""); setName(""); setLast4(""); setSearchError("");
  }, [gymId, uid]);

  const canSearch = mode === "code" ? isFullCode(code) : name.trim().length >= 2 && last4.replace(/[^0-9A-Za-z]/g, "").length === 4;
  const search = useMutation({
    mutationFn: async () =>
      normalizeMembers(await gymService.searchFrontDeskMembers(gymId, mode === "code" ? { code } : { name: name.trim(), last4 })),
    onSuccess: (rows) => { setResults(rows); setSearchError(""); },
    onError: (e) => { setResults(null); setSearchError(assistedErrorText(e)); },
  });

  // ── xác minh + xác nhận ──
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
  const autoMethods = config?.methods ?? [];

  useEffect(() => {
    if (!selected) return;
    setActionError(""); setNotice(""); setPhotoAttested(false); setStatedCode(""); setChallengeId(null); setOtp(""); setExcReason(""); setResendAt(0);
    setPreset(REASON_PRESETS[0]); setOtherReason("");
    const first: AssistedMethod | undefined =
      selected.hasPhoto && autoMethods.includes("PHOTO_MATCH") ? "PHOTO_MATCH" : autoMethods.includes("MEMBER_OTP") ? "MEMBER_OTP" : undefined;
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
  const approvedException: ExceptionRow | undefined = exceptionsQ.data?.exceptions.find(
    (e) => selected && e.membershipId === selected.membershipId && e.status === "APPROVED",
  );
  const pendingException: ExceptionRow | undefined = exceptionsQ.data?.exceptions.find(
    (e) => selected && e.membershipId === selected.membershipId && e.status === "PENDING",
  );

  const sendOtp = useMutation({
    mutationFn: async () => gymService.requestAssistedOtp(gymId, selected!.membershipId),
    onSuccess: (r: { challengeId: string; resendAfterSeconds?: number }) => {
      setChallengeId(r.challengeId); setOtp(""); setActionError("");
      setNotice("Đã gửi mã tới e-mail đăng ký của hội viên. Nhờ hội viên đọc mã gồm 6 chữ số.");
      const at = Date.now() + (r.resendAfterSeconds ?? config?.otpResendSeconds ?? 60) * 1000;
      setResendAt(at); setNow(Date.now());
    },
    onError: (e) => { setNotice(""); setActionError(assistedErrorText(e)); },
  });

  const requestExc = useMutation({
    mutationFn: async () => gymService.requestCheckinException(gymId, { membershipId: selected!.membershipId, reason: excReason.trim() }),
    onSuccess: () => {
      setActionError(""); setNotice("Đã gửi yêu cầu. Chờ quản lý hoặc chủ chi nhánh duyệt, sau đó quay lại bấm Xác nhận.");
      qc.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] });
    },
    onError: (e) => { setNotice(""); setActionError(assistedErrorText(e)); },
  });

  const payloadKey = JSON.stringify([selected?.membershipId, method, reason, photoAttested, statedCode, challengeId, otp, approvedException?.id]);
  // Cùng nội dung (bấm đúp, mạng chập chờn gửi lại) → cùng khoá → máy chủ phát lại, không check-in hai lần. Đổi nội dung → khoá mới.
  const requestId = useMemo(() => newRequestId(), [payloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmEnabled = !!selected && canConfirm({ method, reason, photoAttested, statedCode, otp, challengeId, exceptionId: approvedException?.id ?? null });
  const confirm = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { requestId, membershipId: selected!.membershipId, method, reason };
      if (method === "PHOTO_MATCH") Object.assign(body, { photoMatchAttested: photoAttested, statedMemberCode: statedCode });
      if (method === "MEMBER_OTP") Object.assign(body, { challengeId, otp });
      if (method === "MANAGER_EXCEPTION") Object.assign(body, { exceptionId: approvedException?.id });
      return gymService.assistedCheckIn(gymId, body);
    },
    onSuccess: (r: { displayName?: string; remainingVisits?: number | null; replayed?: boolean }) => {
      setDone({ displayName: r.displayName ?? selected?.displayName ?? "Hội viên", remainingVisits: r.remainingVisits ?? null, replayed: r.replayed === true });
      setSelected(null); setResults(null); setCode(""); setName(""); setLast4("");
      qc.invalidateQueries({ queryKey: ["gym-checkins", gymId] });
      qc.invalidateQueries({ queryKey: ["frontdesk-today", uid, gymId] });
      qc.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] });
    },
    onError: (e) => { setNotice(""); setActionError(assistedErrorText(e)); if (assistedErrorCode(e) === "OTP_ATTEMPTS_EXCEEDED" || assistedErrorCode(e) === "OTP_EXPIRED") setChallengeId(null); },
  });

  const methodBtn = (m: AssistedMethod, label: string, hint: string, disabled: boolean, why?: string) => (
    <button
      key={m}
      type="button"
      disabled={disabled}
      onClick={() => { setMethod(m); setActionError(""); setNotice(""); }}
      aria-pressed={method === m}
      className={`text-left rounded-xl border p-3 w-full transition-all disabled:opacity-40 ${method === m ? "border-green-500/60 bg-green-500/5" : "border-zinc-700/60 bg-zinc-800/30 hover:bg-zinc-800/60"}`}
    >
      <p className="text-sm font-semibold text-zinc-100">{label}</p>
      <p className="text-[11px] text-zinc-500">{disabled && why ? why : hint}</p>
    </button>
  );

  return (
    <div className={card} data-testid="assisted-checkin">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-green-500" />
        <h2 className="text-sm font-bold text-zinc-200">Check-in hộ hội viên</h2>
      </div>
      <p className="text-[11px] text-zinc-600">Dùng khi hội viên không quét được QR (quên điện thoại, hết pin). Phải xác minh danh tính trước khi check-in; mọi bước đều được ghi lại.</p>

      {done && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 flex items-start gap-2" data-testid="assisted-done" role="status">
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-green-400 break-words">{done.replayed ? "Đã check-in từ trước" : "Đã check-in"} cho {done.displayName}</p>
            {done.remainingVisits != null && <p className="text-xs text-zinc-400">Còn {done.remainingVisits} buổi</p>}
          </div>
          <button type="button" aria-label="Đóng thông báo" onClick={() => setDone(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {!selected ? (
        <>
          <div className="grid grid-cols-2 gap-1 bg-zinc-800/60 p-1 rounded-lg" role="tablist">
            {([["code", "Mã hội viên"], ["name", "Tên + 4 ký tự cuối"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setSearchError(""); setResults(null); }}
                className={`px-2 py-2 rounded-md text-xs font-semibold ${mode === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>{label}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (canSearch && !search.isPending) search.mutate(); }} className="space-y-2">
            {mode === "code" ? (
              <input value={code} onChange={(e) => setCode(formatCodeInput(e.target.value))} placeholder="Mã hội viên (XXXX-XXXX)" aria-label="Mã hội viên" inputMode="text" autoCapitalize="characters" autoComplete="off" className={`${input} font-mono tracking-wider`} />
            ) : (
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Đầu tên (vd: Nguyen)" aria-label="Tên hội viên" autoComplete="off" className={input} />
                <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 4))} placeholder="4 cuối" aria-label="4 ký tự cuối của mã hội viên" autoComplete="off" className={`${input} font-mono tracking-wider text-center`} />
              </div>
            )}
            <p className="text-[11px] text-zinc-600">Không tra được bằng tên hay số điện thoại một mình. Hội viên xem mã ở mục “Gói của tôi”.</p>
            <button type="submit" disabled={!canSearch || search.isPending} className={`${primaryBtn} w-full flex items-center justify-center gap-2`}>
              {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Tra cứu
            </button>
          </form>
          {searchError && <p className="text-xs text-red-400" role="alert" data-testid="search-error">{searchError}</p>}
          {results && results.length === 0 && <p className="text-xs text-zinc-500" data-testid="search-empty">Không tìm thấy hội viên phù hợp ở thương hiệu này.</p>}
          {results && results.length > 0 && (
            <div className="space-y-2">{results.map((m) => <MemberCard key={m.membershipId} m={m} onPick={() => { setDone(null); setSelected(m); }} />)}</div>
          )}
        </>
      ) : (
        <div className="space-y-3" data-testid="assisted-verify">
          <button type="button" onClick={() => setSelected(null)} className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Chọn người khác</button>
          <MemberCard m={selected} large />

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-zinc-300">Lý do check-in hộ</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)} className={input} aria-label="Lý do check-in hộ">
              {REASON_PRESETS.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="OTHER">Lý do khác…</option>
            </select>
            {preset === "OTHER" && <input value={otherReason} onChange={(e) => setOtherReason(e.target.value.slice(0, 200))} placeholder="Ghi rõ lý do" aria-label="Lý do khác" className={input} />}
          </label>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-300">Cách xác minh danh tính</p>
            {methodBtn("PHOTO_MATCH", "Đối chiếu ảnh hồ sơ", "So khuôn mặt với ảnh hồ sơ và nhập mã hội viên do hội viên tự đọc",
              !autoMethods.includes("PHOTO_MATCH") || !selected.hasPhoto,
              !autoMethods.includes("PHOTO_MATCH") ? "Cách này đang tắt" : "Hội viên chưa có ảnh hồ sơ")}
            {methodBtn("MEMBER_OTP", "Mã gửi về e-mail hội viên", "Gửi mã 6 số tới e-mail đã đăng ký; hội viên đọc mã cho bạn",
              !autoMethods.includes("MEMBER_OTP"), "Cách này đang tắt")}
            {methodBtn("MANAGER_EXCEPTION", "Xin quản lý duyệt ngoại lệ", "Khi không dùng được hai cách trên; quản lý/chủ chi nhánh duyệt trong ngày", config?.exceptionEnabled === false, "Cách này đang tắt")}
          </div>

          {method === "PHOTO_MATCH" && (
            <div className="space-y-2 rounded-xl bg-zinc-800/30 p-3" data-testid="verify-photo">
              <label className="flex items-start gap-2 text-sm text-zinc-200">
                <input type="checkbox" checked={photoAttested} onChange={(e) => setPhotoAttested(e.target.checked)} className="mt-1 w-4 h-4" />
                <span>Tôi xác nhận người trước mặt trùng với ảnh hồ sơ ở trên.</span>
              </label>
              <input value={statedCode} onChange={(e) => setStatedCode(formatCodeInput(e.target.value))} placeholder="Mã hội viên do hội viên đọc" aria-label="Mã hội viên do hội viên đọc" autoComplete="off" className={`${input} font-mono tracking-wider`} />
              <p className="text-[11px] text-zinc-600">Hãy để hội viên tự đọc mã của mình, đừng đọc hộ.</p>
            </div>
          )}

          {method === "MEMBER_OTP" && (
            <div className="space-y-2 rounded-xl bg-zinc-800/30 p-3" data-testid="verify-otp">
              <button type="button" onClick={() => sendOtp.mutate()} disabled={sendOtp.isPending || resendLeft > 0} className={`${ghostBtn} flex items-center gap-1.5`}>
                {sendOtp.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                {challengeId ? (resendLeft > 0 ? `Gửi lại mã sau ${resendLeft}s` : "Gửi lại mã") : "Gửi mã tới e-mail hội viên"}
              </button>
              {challengeId && (
                <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Mã 6 chữ số" aria-label="Mã xác minh 6 chữ số" inputMode="numeric" autoComplete="one-time-code" className={`${input} font-mono tracking-[0.4em] text-center`} />
              )}
              <p className="text-[11px] text-zinc-600">Mã chỉ dùng một lần và hết hạn sau {Math.round((config?.otpTtlSeconds ?? 300) / 60)} phút.</p>
            </div>
          )}

          {method === "MANAGER_EXCEPTION" && (
            <div className="space-y-2 rounded-xl bg-zinc-800/30 p-3" data-testid="verify-exception">
              {approvedException ? (
                <p className="text-sm text-green-400">Quản lý đã duyệt: “{approvedException.decisionReason}”. Bấm Xác nhận để check-in.</p>
              ) : pendingException ? (
                <p className="text-sm text-amber-400">Đang chờ quản lý duyệt… (tự cập nhật)</p>
              ) : (
                <>
                  <textarea value={excReason} onChange={(e) => setExcReason(e.target.value.slice(0, 300))} rows={3} placeholder="Vì sao không dùng được ảnh hay e-mail? (ít nhất 5 ký tự)" aria-label="Lý do xin ngoại lệ" className={`${input} resize-none`} />
                  <button type="button" onClick={() => requestExc.mutate()} disabled={requestExc.isPending || excReason.trim().length < 5} className={`${ghostBtn} flex items-center gap-1.5`}>
                    {requestExc.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Gửi yêu cầu cho quản lý
                  </button>
                </>
              )}
              <p className="text-[11px] text-zinc-600">Yêu cầu chỉ có hiệu lực trong ngày. Người xin không thể tự duyệt.</p>
            </div>
          )}

          {notice && <p className="text-xs text-green-400" role="status">{notice}</p>}
          {actionError && <p className="text-xs text-red-400" role="alert" data-testid="action-error">{actionError}</p>}
          <button type="button" onClick={() => confirm.mutate()} disabled={!confirmEnabled || confirm.isPending} className={`${primaryBtn} w-full flex items-center justify-center gap-2`} data-testid="assisted-confirm">
            {confirm.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCircle className="w-4 h-4" />} Xác nhận check-in
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Danh sách yêu cầu ngoại lệ HÔM NAY của chi nhánh. Quản lý/chủ: duyệt hoặc từ chối (bắt buộc ghi lý do của chính mình).
 * Lễ tân: chỉ thấy yêu cầu của mình và trạng thái. Máy chủ chặn tự duyệt.
 */
export function CheckinExceptionsPanel({ gymId }: { gymId: string }) {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["frontdesk-exceptions", uid, gymId],
    queryFn: async () => normalizeExceptions(await gymService.listCheckinExceptions(gymId)),
    enabled: !!gymId,
    refetchInterval: 8000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [verb, setVerb] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { setOpenId(null); setReason(""); setErr(""); }, [gymId, uid]);

  const decide = useMutation({
    mutationFn: async () => gymService.decideCheckinException(gymId, openId!, verb, reason.trim()),
    onSuccess: () => { setOpenId(null); setReason(""); setErr(""); qc.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] }); },
    onError: (e) => setErr(assistedErrorText(e)),
  });

  const data = q.data;
  if (!data || data.exceptions.length === 0) return null;
  // Việc cần làm (chờ duyệt / đã duyệt chưa dùng) luôn hiện; việc đã xong gập lại để không đẩy khối check-in xuống.
  const rows = data.exceptions.filter((r) => r.status === "PENDING" || r.status === "APPROVED");
  const doneRows = data.exceptions.filter((r) => r.status !== "PENDING" && r.status !== "APPROVED");
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;

  return (
    <div className={card} data-testid="checkin-exceptions">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-200">{data.canApprove ? "Yêu cầu ngoại lệ chờ duyệt" : "Yêu cầu ngoại lệ của bạn"}</h2>
        {data.canApprove && pendingCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{pendingCount} chờ duyệt</span>}
      </div>
      <ul className="space-y-2">
        {[...rows, ...(showDone ? doneRows : [])].map((r) => {
          const st = EXCEPTION_STATUS_LABEL[r.status];
          const canDecide = data.canApprove && r.status === "PENDING" && !r.mine;
          return (
            <li key={r.id} className="bg-zinc-800/40 rounded-xl p-3 space-y-1.5" data-testid="exception-row">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100 break-words min-w-0">{r.displayName} <span className="font-mono text-xs text-zinc-400 tracking-wider">{r.memberCode}</span></p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.text}</span>
              </div>
              <p className="text-xs text-zinc-500 break-words">{r.planName} · xin bởi {r.requestedByName}{r.createdAt ? ` lúc ${clockLabel(r.createdAt)}` : ""}</p>
              <p className="text-xs text-zinc-300 break-words">Lý do: {r.requestReason}</p>
              {r.decisionReason && <p className="text-xs text-zinc-400 break-words">{r.decidedByName ?? "Quản lý"}: {r.decisionReason}</p>}
              {r.status === "PENDING" && r.mine && data.canApprove && <p className="text-[11px] text-zinc-600">Yêu cầu do bạn tạo — cần người khác duyệt.</p>}
              {canDecide && openId !== r.id && (
                <div className="flex gap-2 pt-1">
                  <button type="button" className={`${ghostBtn} flex-1`} onClick={() => { setOpenId(r.id); setVerb("approve"); setReason(""); setErr(""); }}>Duyệt</button>
                  <button type="button" className={`${ghostBtn} flex-1`} onClick={() => { setOpenId(r.id); setVerb("reject"); setReason(""); setErr(""); }}>Từ chối</button>
                </div>
              )}
              {canDecide && openId === r.id && (
                <div className="space-y-2 pt-1">
                  <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} rows={2} aria-label={verb === "approve" ? "Lý do duyệt" : "Lý do từ chối"} placeholder={verb === "approve" ? "Bạn đã xác minh bằng cách nào? (ít nhất 5 ký tự)" : "Lý do từ chối (ít nhất 5 ký tự)"} className={`${input} resize-none`} />
                  {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
                  <div className="flex gap-2">
                    <button type="button" className={`${primaryBtn} flex-1`} disabled={reason.trim().length < 5 || decide.isPending} onClick={() => decide.mutate()}>
                      {verb === "approve" ? "Xác nhận duyệt" : "Xác nhận từ chối"}
                    </button>
                    <button type="button" className={ghostBtn} onClick={() => setOpenId(null)}>Huỷ</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {doneRows.length > 0 && (
        <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200 underline" onClick={() => setShowDone((v) => !v)} data-testid="toggle-done-exceptions">
          {showDone ? "Ẩn yêu cầu đã xử lý" : `Xem ${doneRows.length} yêu cầu đã xử lý`}
        </button>
      )}
    </div>
  );
}
