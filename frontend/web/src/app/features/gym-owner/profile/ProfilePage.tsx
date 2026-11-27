/**
 * Hồ sơ của tôi (batch G6), `/gym-owner/profile`, behind VITE_GYM_OWNER_V2. Parity with the legacy `GymOwnerProfilePage` (PARITY.md):
 * số điện thoại liên hệ (every role), tài khoản nhận tiền (owner only: it is the account every withdrawal of Tài chính goes to, and the
 * page says so), đổi mật khẩu (every role), liên kết chi nhánh. The brand block moved to Thương hiệu (a link is kept here for those who may
 * read it). What a person sees or changes comes from the server's permissions[] (fail-closed; unknown role = nothing; no owner fallback).
 * `?section=payout|phone|password|links` scrolls to a section (the withdrawal dialog links to the payout one).
 * Each save: 04 text-states, 10 success-check ONLY after the 2xx, 12 shake + role="alert" on a refusal. Typed-but-unsaved input asks first.
 */
import { useEffect, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CaretRightIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import { authService, gymService } from "../../../services/api";
import { authErrorMessage } from "../../../utils/authErrors";
import { PARTNER_ROLE_CHIP_LABEL, canUseFeature } from "../../../utils/gymStaffRole";
import type { GymBrand } from "../../../types";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { branchCodes } from "../scope/scopeModel";
import { publicBrandName } from "../brand/brandModel";
import {
  PASSWORD_MIN,
  PAYOUT_EMPTY_NOTE,
  PAYOUT_SOURCE_NOTE,
  SECTION_DOM_ID,
  branchStatusWord,
  hasPayoutOnFile,
  parseSection,
  passwordState,
  payoutAuditNote,
  payoutDirty,
  payoutFrom,
  payoutMissingField,
  payoutPayload,
  payoutValid,
  phoneState,
  profileFailure,
  shouldAskBeforeLeaving,
  showBrandLink,
  showPayout,
  type PayoutForm,
  type SavedPayout,
} from "./profileModel";

type Phase = "idle" | "saving" | "done";
interface OnboardingStatus {
  role?: string;
  permissions?: string[];
  hasPartnerAccount?: boolean;
  contactPhone?: string | null;
  payout?: SavedPayout;
}

export function ProfilePage() {
  const { user } = useApp();
  const scope = useGymOwnerScope();
  const [params] = useSearchParams();
  const section = parseSection(params.get("section"));
  const status = useQuery<OnboardingStatus>({ queryKey: ["partner-onboarding-status"], queryFn: () => gymService.getOnboardingStatus() });
  const brandsQ = useQuery<GymBrand[]>({ queryKey: ["owned-brands"], queryFn: () => gymService.listOwnedBrands(), enabled: showBrandLink(scope.can) });
  const brand = brandsQ.data?.[0];
  const dirty = useRef({ phone: false, payout: false, password: false });
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldAskBeforeLeaving({ dirty: dirty.current.phone || dirty.current.payout || dirty.current.password, from: currentLocation, to: nextLocation }),
  );
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!(dirty.current.phone || dirty.current.payout || dirty.current.password)) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // `?section=` lands on that block once the data it shows has arrived.
  const loaded = status.isFetched && scope.status === "ready";
  useEffect(() => {
    if (!section || !loaded) return;
    const el = document.getElementById(SECTION_DOM_ID[section]);
    if (!el) return;
    el.scrollIntoView?.({ block: "start" });
    (el.querySelector("h2") as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, [section, loaded]);

  if (scope.status === "ready" && !scope.role) return <ScopeStateFrame kind="forbidden" />;
  const s = status.data;
  const roleLabel = scope.role ? PARTNER_ROLE_CHIP_LABEL[scope.role] : undefined;
  const payoutShown = showPayout(scope.can, s?.payout);

  return (
    <div className="go-wrap" data-testid="go-profile-page" data-section={section ?? undefined}>
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-profile-title">Hồ sơ của tôi</h1>
          <p className="go-page-sub go-profile-id">
            <span data-testid="go-profile-email">{user?.email}</span>
            {roleLabel && <span className="go-profile-role" data-testid="profile-role-chip">{roleLabel}</span>}
          </p>
        </div>
      </header>

      {status.isError && !s && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-profile-error">
          <span>Chưa tải được hồ sơ. Chưa kết luận số điện thoại hay tài khoản nhận tiền hiện tại là gì.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => void status.refetch()}>Thử lại</button>
        </div>
      )}

      <PhoneSection status={s} loading={status.isLoading} onDirty={(v) => (dirty.current.phone = v)} />
      {payoutShown && <PayoutSection saved={s?.payout} email={user?.email} onDirty={(v) => (dirty.current.payout = v)} />}
      <PasswordSection onDirty={(v) => (dirty.current.password = v)} />
      <LinksSection brand={brand} showBrand={showBrandLink(scope.can)} />

      <GoModal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        closeOnBackdrop={false}
        testId="go-profile-leave"
        title="Rời đi khi chưa lưu?"
        description="Bạn đã nhập thông tin chưa lưu. Sang trang khác sẽ làm mất những gì đã nhập."
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => blocker.reset?.()}>Ở lại</button>
            <button
              type="button"
              className="go-btn"
              data-variant="danger"
              data-testid="go-profile-leave-go"
              onClick={() => {
                dirty.current = { phone: false, payout: false, password: false };
                blocker.proceed?.();
              }}
            >
              Rời đi
            </button>
          </>
        }
      />
    </div>
  );
}

function SectionHead({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="go-panel-head">
      <h2 id={`${id}-h`} tabIndex={-1}>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- phone
function PhoneSection({ status, loading, onDirty }: { status: OnboardingStatus | undefined; loading: boolean; onDirty: (d: boolean) => void }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = status?.contactPhone ?? null;
  useEffect(() => setPhone(saved ?? ""), [saved]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const st = phoneState(phone, saved);
  useEffect(() => {
    onDirty(st.dirty);
    return () => onDirty(false);
  }, [st.dirty, onDirty]);
  const save = useMutation({ mutationFn: () => gymService.submitOnboardingContact(phone.trim()) });

  const submit = async () => {
    if (phase !== "idle" || !st.dirty || !st.valid) return;
    setRefusal("");
    setPhase("saving");
    try {
      await save.mutateAsync();
      setPhase("done"); // 2xx only
      toast.success("Đã cập nhật số điện thoại");
      void queryClient.invalidateQueries({ queryKey: ["partner-onboarding-status"] });
      timer.current = setTimeout(() => setPhase("idle"), 1800);
    } catch (err) {
      setPhase("idle");
      setRefusal(profileFailure(err, "phone").text);
      shake.shake();
    }
  };

  return (
    <section className="go-panel" id="profile-phone" aria-labelledby="profile-phone-h" data-testid="go-profile-phone">
      <SectionHead id="profile-phone" title="Số điện thoại liên hệ">Gymini dùng số này khi cần liên hệ trực tiếp với bạn.</SectionHead>
      {status?.hasPartnerAccount === false ? (
        <p className="go-panel-pad go-muted-text">Tài khoản của bạn được tạo trước khi có hồ sơ đối tác nên chưa có số liên hệ riêng. Liên hệ Gymini nếu cần cập nhật.</p>
      ) : (
        <div ref={shake.ref} className="go-form-box go-panel-pad">
          {refusal && <p className="go-error" role="alert" data-testid="go-phone-refusal">{refusal}</p>}
          <label className="go-field">
            <span className="go-label">Số điện thoại</span>
            <input className="go-input" aria-label="Số điện thoại" inputMode="tel" maxLength={20} disabled={loading || !status} aria-invalid={st.problem ? true : undefined} value={phone} onChange={(e) => { setPhone(e.target.value); if (refusal) setRefusal(""); }} data-testid="go-phone-input" />
            {st.problem && <span className="go-field-error" role="alert">{st.problem}</span>}
          </label>
          <div className="go-form-actions">
            <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={!st.dirty || !st.valid || phase === "saving"} data-testid="go-phone-save">
              <SuccessCheck show={phase === "done"} />
              <TextStates value={phase === "saving" ? "Đang lưu" : phase === "done" ? "Đã lưu" : "Lưu số điện thoại"} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- payout
function PayoutSection({ saved, email, onDirty }: { saved: SavedPayout; email: string | undefined; onDirty: (d: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PayoutForm>(() => payoutFrom(saved));
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const [touched, setTouched] = useState(false);
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedKey = `${saved?.bankName ?? ""}|${saved?.accountNumber ?? ""}|${saved?.accountHolder ?? ""}`;
  useEffect(() => setForm(payoutFrom(saved)), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the saved values are the dependency
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const dirty = payoutDirty(saved, form);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const save = useMutation({ mutationFn: () => gymService.submitOnboardingPayout(payoutPayload(form)) });
  const missing = touched ? payoutMissingField(form) : null;
  const onFile = hasPayoutOnFile(saved);
  const set = (patch: Partial<PayoutForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (refusal) setRefusal("");
  };

  const submit = async () => {
    if (phase !== "idle") return;
    setTouched(true);
    if (!payoutValid(form)) {
      shake.shake();
      return;
    }
    setRefusal("");
    setPhase("saving");
    try {
      await save.mutateAsync();
      setPhase("done"); // 2xx only
      toast.success("Đã cập nhật tài khoản nhận tiền");
      void queryClient.invalidateQueries({ queryKey: ["partner-onboarding-status"] });
      timer.current = setTimeout(() => setPhase("idle"), 1800);
    } catch (err) {
      setPhase("idle");
      setRefusal(profileFailure(err, "payout").text);
      shake.shake();
    }
  };

  return (
    <section className="go-panel" id="profile-payout" aria-labelledby="profile-payout-h" data-testid="go-profile-payout">
      <SectionHead id="profile-payout" title="Tài khoản nhận tiền">Chỉ chủ phòng tập thấy và đổi được.</SectionHead>
      <div ref={shake.ref} className="go-form-box go-panel-pad">
        <p className="go-note" role="note" data-testid="go-payout-source">{PAYOUT_SOURCE_NOTE}</p>
        {!onFile && <p className="go-note" data-tone="warn" role="note" data-testid="go-payout-empty">{PAYOUT_EMPTY_NOTE}</p>}
        {refusal && <p className="go-error" role="alert" data-testid="go-payout-refusal">{refusal}</p>}
        <label className="go-field">
          <span className="go-label">Ngân hàng</span>
          <input className="go-input" aria-label="Ngân hàng" placeholder="Ví dụ: Vietcombank" maxLength={100} value={form.bankName} onChange={(e) => set({ bankName: e.target.value })} data-testid="go-payout-bank" />
        </label>
        <div className="go-grid-2">
          <label className="go-field">
            <span className="go-label">Số tài khoản</span>
            <input className="go-input" aria-label="Số tài khoản" inputMode="numeric" maxLength={30} value={form.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} data-testid="go-payout-number" />
          </label>
          <label className="go-field">
            <span className="go-label">Tên chủ tài khoản</span>
            <input className="go-input" aria-label="Tên chủ tài khoản" maxLength={100} value={form.accountHolder} onChange={(e) => set({ accountHolder: e.target.value })} data-testid="go-payout-holder" />
          </label>
        </div>
        {missing && <span className="go-field-error" role="alert">{missing}</span>}
        <p className="go-hint-text">{payoutAuditNote(email)}</p>
        <div className="go-form-actions">
          <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={!dirty || phase === "saving"} data-testid="profile-payout-save">
            <SuccessCheck show={phase === "done"} />
            <TextStates value={phase === "saving" ? "Đang lưu" : phase === "done" ? "Đã lưu" : "Lưu tài khoản nhận tiền"} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- password
function PasswordSection({ onDirty }: { onDirty: (d: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const st = passwordState(current, next, confirm);
  useEffect(() => {
    onDirty(st.anyTyped && phase !== "done");
    return () => onDirty(false);
  }, [st.anyTyped, phase, onDirty]);
  const change = useMutation({ mutationFn: () => authService.changePassword({ currentPassword: current, newPassword: next }) });

  const submit = async () => {
    if (phase !== "idle" || !st.canSubmit) return;
    setRefusal("");
    setPhase("saving");
    try {
      await change.mutateAsync();
      setPhase("done"); // 2xx only
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Đã đổi mật khẩu");
      timer.current = setTimeout(() => setPhase("idle"), 1800);
    } catch (err) {
      setPhase("idle");
      setRefusal(authErrorMessage(err, "Không đổi được mật khẩu. Kiểm tra lại mật khẩu hiện tại."));
      shake.shake();
    }
  };

  const rows: [string, string, (v: string) => void, string][] = [
    ["Mật khẩu hiện tại", current, setCurrent, "current-password"],
    ["Mật khẩu mới", next, setNext, "new-password"],
    ["Nhập lại mật khẩu mới", confirm, setConfirm, "new-password"],
  ];

  return (
    <section className="go-panel" id="profile-password" aria-labelledby="profile-password-h" data-testid="go-profile-password">
      <SectionHead id="profile-password" title="Đổi mật khẩu">Mật khẩu mới tối thiểu {PASSWORD_MIN} ký tự.</SectionHead>
      <div ref={shake.ref} className="go-form-box go-panel-pad">
        {refusal && <p className="go-error" role="alert" data-testid="go-password-refusal">{refusal}</p>}
        {rows.map(([label, value, setter, auto], i) => (
          <label key={label} className="go-field">
            <span className="go-label">{label}</span>
            <input className="go-input" aria-label={label} type={show ? "text" : "password"} autoComplete={auto} value={value} onChange={(e) => { setter(e.target.value); if (refusal) setRefusal(""); }} data-testid={`go-password-${i}`} />
          </label>
        ))}
        {st.tooShort && <span className="go-field-error" role="alert">Mật khẩu mới cần ít nhất {PASSWORD_MIN} ký tự.</span>}
        {st.mismatch && <span className="go-field-error" role="alert">Hai lần nhập mật khẩu mới chưa khớp.</span>}
        <div className="go-form-actions go-form-actions-split">
          <button type="button" className="go-btn go-btn-sm" onClick={() => setShow((v) => !v)} aria-pressed={show} data-testid="go-password-toggle">
            {show ? <EyeSlashIcon aria-hidden="true" width={16} height={16} /> : <EyeIcon aria-hidden="true" width={16} height={16} />}
            {show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          </button>
          <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={!st.canSubmit || phase === "saving"} data-testid="go-password-save">
            <SuccessCheck show={phase === "done"} />
            <TextStates value={phase === "saving" ? "Đang đổi" : phase === "done" ? "Đã đổi" : "Đổi mật khẩu"} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- brand + branches
function LinksSection({ brand, showBrand }: { brand: GymBrand | undefined; showBrand: boolean }) {
  const scope = useGymOwnerScope();
  const codes = branchCodes(scope.gyms);
  // The branch pages are for owner and manager (the route guard bounces the others), so only they get links.
  const linkable = canUseFeature(scope.role, "gymManage");
  const settings = scope.can("branch.write");
  return (
    <section className="go-panel" id="profile-branches" aria-labelledby="profile-branches-h" data-testid="go-profile-links">
      <SectionHead id="profile-branches" title="Thương hiệu và chi nhánh">
        {settings ? "Ảnh, giới thiệu, điện thoại, giờ mở cửa và vị trí được chỉnh riêng cho từng chi nhánh." : "Các chi nhánh bạn làm việc."}
      </SectionHead>
      {showBrand && (
        <div className="go-links-brand" data-testid="go-profile-brand-link">
          <div>
            <p className="go-dt-main">{brand ? publicBrandName(brand) : "Thương hiệu"}</p>
            <p className="go-dt-sub">Tên, logo, giới thiệu và mạng xã hội của thương hiệu.</p>
          </div>
          <GoLink to="/gym-owner/brand" className="go-btn go-btn-sm">Mở Thương hiệu</GoLink>
        </div>
      )}
      {scope.gyms.length === 0 ? (
        <p className="go-panel-pad go-muted-text" data-testid="go-profile-no-branch">Chưa có chi nhánh nào.</p>
      ) : (
        <ul className="go-pb-list" data-testid="go-profile-branches">
          {scope.gyms.map((g) => (
            <li key={g.id} className="go-pb-row" data-testid="go-profile-branch">
              <span className="go-code-chip" aria-hidden="true">{codes[g.id] ?? "--"}</span>
              <div className="go-pb-main">
                <span className="go-pb-name">{g.name}</span>
                <span className="go-dt-sub">{branchStatusWord(g.status)}</span>
              </div>
              {linkable && (
                <GoLink to={settings ? `/gym-owner/gyms/${encodeURIComponent(g.id)}?settings=1` : `/gym-owner/gyms/${encodeURIComponent(g.id)}`} className="go-btn go-btn-sm" aria-label={`${settings ? "Sửa" : "Mở"} chi nhánh ${g.name}`}>
                  {settings ? "Sửa thông tin" : "Mở chi nhánh"} <CaretRightIcon aria-hidden="true" width={14} height={14} />
                </GoLink>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
