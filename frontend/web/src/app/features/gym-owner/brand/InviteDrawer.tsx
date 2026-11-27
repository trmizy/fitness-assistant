/**
 * "Mời nhân sự" drawer (owner only): the legacy invite call `gymService.inviteManager({ email, role, scopedGymIds })`. The rule about
 * branches is said before the owner picks any (Quản lý và Lễ tân phải có ít nhất 1 chi nhánh; Kế toán bỏ trống = toàn thương hiệu) and the
 * same rule blocks the button. The server stays the authority: its own sentence is shown when it refuses (12 shake, role="alert").
 * 10 success-check plays ONLY after the 2xx. Closing with anything typed asks first.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { branchCodes } from "../scope/scopeModel";
import {
  EMPTY_INVITE,
  STAFF_ROLES,
  STAFF_ROLE_ORDER,
  inviteDirty,
  invitePayload,
  inviteProblems,
  staffFailure,
  toggleBranch,
  type InviteForm,
  type StaffRole,
} from "./brandModel";

type Phase = "idle" | "sending" | "done";
export interface InviteResult {
  email: string;
  inviteLink: string;
  emailSent: boolean;
}

export function InviteDrawer({
  open,
  branches,
  onClose,
  onSent,
  onFailedUnclear,
  onDirty,
}: {
  open: boolean;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSent: (r: InviteResult) => void;
  /** A 5xx / no answer: the invitation may exist, so the lists are reloaded. */
  onFailedUnclear: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<InviteForm>(EMPTY_INVITE);
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const radios = useRef<Record<string, HTMLButtonElement | null>>({});
  const codes = branchCodes(branches);

  // A fresh form every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_INVITE);
    setTouched(false);
    setPhase("idle");
    setRefusal("");
    setAskDiscard(false);
  }, [open]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const send = useMutation({ mutationFn: (f: InviteForm) => gymService.inviteManager(invitePayload(f)) });
  const info = STAFF_ROLES[form.role];
  const problems = touched ? inviteProblems(form) : {};
  const dirty = open && phase !== "done" && inviteDirty(form);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const requestClose = () => {
    if (phase === "sending") return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };
  const set = (patch: Partial<InviteForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (refusal) setRefusal("");
  };

  const submit = async () => {
    if (phase !== "idle") return;
    setTouched(true);
    if (Object.keys(inviteProblems(form)).length > 0) {
      shake.shake();
      return;
    }
    setRefusal("");
    setPhase("sending");
    try {
      const data = (await send.mutateAsync(form)) as { inviteLink?: string; emailSent?: boolean };
      setPhase("done"); // 2xx only
      onSent({ email: form.email.trim(), inviteLink: String(data?.inviteLink ?? ""), emailSent: !!data?.emailSent });
      timer.current = setTimeout(onClose, 700);
    } catch (err) {
      const f = staffFailure(err, "invite");
      setPhase("idle");
      setRefusal(f.text);
      shake.shake();
      if (f.unclear) onFailedUnclear();
    }
  };

  const onRadioKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = STAFF_ROLE_ORDER[(i + step + STAFF_ROLE_ORDER.length) % STAFF_ROLE_ORDER.length];
    set({ role: next, scopedGymIds: form.scopedGymIds });
    radios.current[next]?.focus();
  };

  const label = phase === "sending" ? "Đang gửi" : phase === "done" ? "Đã gửi" : "Gửi lời mời";

  return (
    <>
      <GoDrawer
        open={open}
        onClose={requestClose}
        busy={phase === "sending"}
        closeOnBackdrop={false}
        initialFocusRef={emailRef}
        title="Mời nhân sự"
        description="Mời một người làm quản lý, lễ tân hoặc kế toán của thương hiệu bằng email."
        testId="go-invite-drawer"
        meta={<span className="go-muted">Mỗi người một tài khoản đăng nhập riêng</span>}
        footer={
          <div className="go-drawer-foot-row">
            <button type="button" className="go-btn" onClick={requestClose} disabled={phase === "sending"}>Huỷ</button>
            <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={phase !== "idle"} data-testid="go-invite-send">
              <SuccessCheck show={phase === "done"} />
              <TextStates value={label} />
            </button>
          </div>
        }
      >
        <div ref={shake.ref} className="go-form-box" data-testid="go-invite-form">
          {refusal && <p className="go-error" role="alert" data-testid="go-invite-refusal">{refusal}</p>}

          <div className="go-field" role="radiogroup" aria-label="Vai trò">
            <span className="go-label">Vai trò</span>
            <div className="go-seg go-seg-grid">
              {STAFF_ROLE_ORDER.map((r: StaffRole, i) => (
                <button
                  key={r}
                  ref={(el) => {
                    radios.current[r] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={form.role === r}
                  aria-pressed={form.role === r}
                  tabIndex={form.role === r ? 0 : -1}
                  data-testid={`invite-role-${r}`}
                  onClick={() => set({ role: r })}
                  onKeyDown={(e) => onRadioKey(e, i)}
                >
                  {STAFF_ROLES[r].chip}
                </button>
              ))}
            </div>
            <p className="go-hint-text" data-testid="go-invite-blurb">{info.blurb}</p>
          </div>

          <label className="go-field">
            <span className="go-label">Email</span>
            <input
              ref={emailRef}
              className="go-input"
              type="email"
              inputMode="email"
              autoComplete="off"
              aria-label="Email nhân sự"
              aria-invalid={problems.email ? true : undefined}
              placeholder="nhanvien@example.com"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              data-testid="go-invite-email"
            />
            {problems.email && <span className="go-field-error" role="alert">{problems.email}</span>}
          </label>

          <fieldset className="go-fieldset" aria-describedby="go-invite-rule">
            <legend className="go-label">{info.needsBranch ? "Chi nhánh phụ trách" : "Chi nhánh được xem"}</legend>
            <p className="go-hint-text" id="go-invite-rule" data-testid="go-invite-rule">{info.scopeRule}</p>
            <div className="go-check-list" data-testid="go-invite-branches">
              {branches.map((g) => (
                <label key={g.id} className="go-check">
                  <input type="checkbox" checked={form.scopedGymIds.includes(g.id)} onChange={() => set({ scopedGymIds: toggleBranch(form.scopedGymIds, g.id) })} />
                  <span className="go-code-chip" aria-hidden="true">{codes[g.id] ?? "--"}</span>
                  <span className="go-check-name">{g.name}</span>
                </label>
              ))}
              {branches.length === 0 && <p className="go-muted-text">Chưa có chi nhánh nào để gán.</p>}
            </div>
            {!info.needsBranch && form.scopedGymIds.length === 0 && <p className="go-hint-text" data-testid="go-invite-all">Không chọn chi nhánh nào: kế toán xem toàn thương hiệu.</p>}
            {problems.branches && <span className="go-field-error" role="alert" data-testid="go-invite-branch-error">{problems.branches}</span>}
          </fieldset>
        </div>
      </GoDrawer>

      <GoModal
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title="Bỏ lời mời đang soạn?"
        description="Email và chi nhánh bạn đã chọn chưa được gửi và sẽ mất."
        testId="go-invite-discard"
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => setAskDiscard(false)}>Tiếp tục soạn</button>
            <button type="button" className="go-btn" data-variant="danger" data-testid="go-invite-discard-go" onClick={() => { setAskDiscard(false); onClose(); }}>Bỏ và đóng</button>
          </>
        }
      />
    </>
  );
}
