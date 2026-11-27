/**
 * Tab "Nhân sự" (owner, `staff.manage`): the accounts of the brand's staff and the invitations still waiting, with the legacy actions and
 * the legacy API: `listPartnerAccounts`, `listPartnerInvitations`, `inviteManager`, `resendManagerInvitation`, `revokeManagerInvitation`,
 * `revokePartnerAccount`. Branch rules as the backend states them: Quản lý and Lễ tân need at least one branch; Kế toán empty = the whole
 * brand. Every revoke asks first and names the consequence. The invitation link appears exactly where the legacy page showed it (right
 * after an invitation is created; a resend copies it) and is never logged. There is no role / branch edit: the API has none (said on screen).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyIcon, PlusIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoRowMenu } from "../../../components/layout/gym-owner/GoRowMenu";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope, useScopeChangeEffect } from "../scope/GymOwnerScopeProvider";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { ALL_BRANCHES, branchCodes, classifyApiError, goKey } from "../scope/scopeModel";
import { InviteDrawer, type InviteResult } from "./InviteDrawer";
import {
  NO_EDIT_NOTE,
  RESEND_NOTE,
  activeStaff,
  inviteAgeText,
  inviteIsOld,
  pendingInvites,
  revokeAccountCopy,
  revokeInviteCopy,
  roleChipText,
  scopeOf,
  staffFailure,
  staffName,
  type ConfirmCopy,
  type RawAccount,
  type RawInvitation,
} from "./brandModel";

type Target = { kind: "account"; id: string; name: string; role: string } | { kind: "invite"; id: string; email: string; role: string };
type Phase = "idle" | "working" | "done";

const COLS_ACCOUNTS = "minmax(0, 1.8fr) minmax(0, 0.9fr) minmax(0, 1.7fr) minmax(0, 1fr) 132px";
const COLS_INVITES = "minmax(0, 1.8fr) minmax(0, 0.9fr) minmax(0, 1.7fr) minmax(0, 1.2fr) 200px";

export function StaffTab({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const scope = useGymOwnerScope();
  const queryClient = useQueryClient();
  const brandScope = { ...scope, gymId: ALL_BRANCHES };
  const accountsKey = goKey(brandScope, "staff-accounts");
  const invitesKey = goKey(brandScope, "staff-invitations");
  const enabled = scope.status === "ready" && scope.can("staff.manage");
  const accountsQ = useQuery<RawAccount[]>({ queryKey: accountsKey, queryFn: () => gymService.listPartnerAccounts(), enabled, retry: false });
  const invitesQ = useQuery<RawInvitation[]>({ queryKey: invitesKey, queryFn: () => gymService.listPartnerInvitations(), enabled, retry: false });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [created, setCreated] = useState<InviteResult | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState<{ text: string; unclear: boolean } | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);
  const shake = useShake<HTMLDivElement>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const triggers = useRef(new Map<string, HTMLElement>());
  const codes = branchCodes(scope.gyms);
  useScopeChangeEffect(() => {
    setInviteOpen(false);
    setTarget(null);
  });
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: accountsKey });
    void queryClient.invalidateQueries({ queryKey: invitesKey });
    // The legacy page's keys, so the old screens (and the flag-off build) never show a stale list.
    void queryClient.invalidateQueries({ queryKey: ["owner-partner-accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["owner-partner-invitations"] });
  };

  if ((accountsQ.isError && !accountsQ.data) || (invitesQ.isError && !invitesQ.data)) {
    const err = accountsQ.error ?? invitesQ.error;
    if (classifyApiError(err) === "forbidden") return <ScopeStateFrame kind="forbidden" />;
    return (
      <div className="go-state" role="alert" data-testid="go-staff-error">
        <h2>Không tải được danh sách nhân sự</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận bạn có hay không có nhân sự hay lời mời nào.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={reload}>Thử lại</button></div>
      </div>
    );
  }

  const loading = accountsQ.isLoading || invitesQ.isLoading || !enabled;
  const nowMs = Date.now();
  const staff = activeStaff(accountsQ.data);
  const invites = pendingInvites(invitesQ.data);

  const closeTarget = () => {
    const id = target ? (target.kind === "account" ? `a-${target.id}` : `i-${target.id}`) : null;
    setTarget(null);
    setPhase("idle");
    setDialogError("");
    if (id) requestAnimationFrame(() => setTimeout(() => triggers.current.get(id)?.focus(), 0));
  };

  const confirmRevoke = async () => {
    if (!target || phase !== "idle") return;
    setDialogError("");
    setPhase("working");
    try {
      if (target.kind === "account") await gymService.revokePartnerAccount(target.id, "Thu hồi bởi chủ sở hữu");
      else await gymService.revokeManagerInvitation(target.id);
      setPhase("done"); // 2xx only
      toast.success(target.kind === "account" ? "Đã thu hồi tài khoản" : "Đã thu hồi lời mời");
      reload();
      later(closeTarget, 800);
    } catch (err) {
      const f = staffFailure(err, target.kind === "account" ? "revokeAccount" : "revokeInvite");
      setPhase("idle");
      setDialogError(f.text);
      shake.shake();
      reload();
    }
  };

  const resend = async (inv: RawInvitation) => {
    if (resending) return;
    setNotice(null);
    setResending(inv.id);
    try {
      const data = (await gymService.resendManagerInvitation(inv.id)) as { inviteLink?: string };
      // Exactly the legacy behaviour: the new link is copied to the clipboard, never drawn or logged.
      if (data?.inviteLink) navigator.clipboard?.writeText(data.inviteLink).catch(() => {});
      setResent(inv.id); // 2xx only
      toast.success("Đã gửi lại thư mời. Liên kết mới đã được sao chép.");
      reload();
      later(() => setResent((v) => (v === inv.id ? null : v)), 2200);
    } catch (err) {
      const f = staffFailure(err, "resend");
      setNotice({ text: f.text, unclear: f.unclear });
      reload();
    } finally {
      setResending(null);
    }
  };

  const copy: ConfirmCopy | null = target ? (target.kind === "account" ? revokeAccountCopy(target.name, target.role) : revokeInviteCopy(target.email)) : null;

  const scopeCell = (role: string | undefined, ids: readonly string[] | null | undefined) => {
    const s = scopeOf(role, ids, scope.gyms);
    if (s.kind === "all") return <span data-testid="go-staff-scope" data-kind="all">{s.text}</span>;
    if (s.kind === "none") return <span className="go-muted" data-testid="go-staff-scope" data-kind="none">{s.text}</span>;
    return (
      <ul className="go-chip-list" data-testid="go-staff-scope" data-kind="some">
        {s.names.map((n) => (
          <li key={n.id}><span className="go-code-chip" aria-hidden="true">{codes[n.id] ?? "--"}</span><span>{n.name}</span></li>
        ))}
      </ul>
    );
  };

  return (
    <div className="go-stack" data-testid="go-staff">
      {notice && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-staff-notice">
          <span>{notice.text}</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => setNotice(null)}>Đóng</button>
        </div>
      )}

      <section className="go-panel go-panel-menus" aria-labelledby="go-h-staff">
        <div className="go-panel-head go-panel-head-row">
          <div>
            <h2 id="go-h-staff">Tài khoản nhân sự</h2>
            <p>Quản lý, lễ tân và kế toán đang có quyền vào phòng tập của bạn.</p>
          </div>
          <button type="button" className="go-btn" data-variant="primary" onClick={() => setInviteOpen(true)} disabled={loading} data-testid="go-staff-invite">
            <PlusIcon aria-hidden="true" width={16} height={16} /> Mời nhân sự
          </button>
        </div>

        {loading && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-staff-skeleton">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "45%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
            ))}
          </div>
        )}
        {!loading && staff.length === 0 && (
          <div className="go-task-empty" data-testid="go-staff-empty">
            <strong>Chưa có nhân sự nào</strong>
            <span>Chọn "Mời nhân sự" để cấp tài khoản riêng cho quản lý, lễ tân hoặc kế toán.</span>
          </div>
        )}
        {!loading && staff.length > 0 && (
          <div role="table" className="go-dt" aria-label="Tài khoản nhân sự" data-testid="go-staff-table" style={{ "--go-cols": COLS_ACCOUNTS } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              <div role="columnheader">Tên</div>
              <div role="columnheader">Vai trò</div>
              <div role="columnheader">Chi nhánh được gán</div>
              <div role="columnheader">Trạng thái</div>
              <div role="columnheader"><span className="sr-only">Thao tác</span></div>
            </div>
            {staff.map((a) => (
              <div key={a.id} role="row" className="go-dt-row" data-testid="go-staff-row" data-account-id={a.id} data-role={a.role}>
                <div role="cell" className="go-dt-cell go-dt-first">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span className="go-dt-main">{staffName(a)}</span>
                    <span className="go-dt-sub">{a.identity?.email}</span>
                  </div>
                </div>
                <div role="cell" className="go-dt-cell" data-label="Vai trò" data-testid="staff-role-chip">{roleChipText(a.role ?? "")}</div>
                <div role="cell" className="go-dt-cell" data-label="Chi nhánh được gán">{scopeCell(a.role, a.scopedGymIds)}</div>
                <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone="ok" text="Đang hoạt động" /></div>
                <div role="cell" className="go-dt-cell go-dt-actions">
                  <GoRowMenu
                    label={`Thao tác với ${staffName(a)}`}
                    testId="staff-menu-button"
                    triggerRef={(el) => {
                      if (el) triggers.current.set(`a-${a.id}`, el);
                      else triggers.current.delete(`a-${a.id}`);
                    }}
                    items={[{ label: "Thu hồi quyền", ariaLabel: `Thu hồi quyền của ${staffName(a)}`, danger: true, testId: "staff-revoke-item", onSelect: () => setTarget({ kind: "account", id: a.id, name: staffName(a), role: a.role ?? "" }) }]}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="go-panel-foot" data-testid="go-staff-noedit">{NO_EDIT_NOTE}</p>
      </section>

      {!loading && invites.length > 0 && (
        <section className="go-panel go-panel-menus" aria-labelledby="go-h-invites" data-testid="go-invites">
          <div className="go-panel-head">
            <h2 id="go-h-invites">Lời mời đang chờ</h2>
            <p>Người được mời chưa nhận. {RESEND_NOTE}</p>
          </div>
          <div role="table" className="go-dt" aria-label="Lời mời đang chờ" data-testid="go-invites-table" style={{ "--go-cols": COLS_INVITES } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              <div role="columnheader">Email</div>
              <div role="columnheader">Vai trò</div>
              <div role="columnheader">Chi nhánh được gán</div>
              <div role="columnheader">Lời mời</div>
              <div role="columnheader"><span className="sr-only">Thao tác</span></div>
            </div>
            {invites.map((inv) => {
              const old = inviteIsOld(inv.createdAt, nowMs);
              const ids = (inv as { scopedGymIds?: string[] }).scopedGymIds;
              return (
                <div key={inv.id} role="row" className="go-dt-row" data-testid="go-invite-row" data-invite-id={inv.id}>
                  <div role="cell" className="go-dt-cell go-dt-first"><span className="go-dt-main">{inv.email}</span></div>
                  <div role="cell" className="go-dt-cell" data-label="Vai trò">{roleChipText(inv.role ?? "")}</div>
                  <div role="cell" className="go-dt-cell" data-label="Chi nhánh được gán">{scopeCell(inv.role, ids)}</div>
                  <div role="cell" className="go-dt-cell" data-label="Lời mời">
                    <GoTag tone={old ? "warn" : "info"} text="Chờ nhận" />
                    <span className="go-dt-sub" data-testid="go-invite-age">{inviteAgeText(inv.createdAt, nowMs)}{old ? ", đã hơn 7 ngày" : ""}</span>
                  </div>
                  <div role="cell" className="go-dt-cell go-dt-actions">
                    <button type="button" className="go-btn go-btn-sm" onClick={() => void resend(inv)} disabled={!!resending} aria-label={`Gửi lại lời mời tới ${inv.email}`} data-testid="go-invite-resend">
                      <SuccessCheck show={resent === inv.id} size={14} />
                      <TextStates value={resending === inv.id ? "Đang gửi" : resent === inv.id ? "Đã gửi lại" : "Gửi lại"} />
                    </button>
                    <GoRowMenu
                      label={`Thao tác với lời mời tới ${inv.email}`}
                      testId="go-invite-menu"
                      triggerRef={(el) => {
                        if (el) triggers.current.set(`i-${inv.id}`, el);
                        else triggers.current.delete(`i-${inv.id}`);
                      }}
                      items={[{ label: "Thu hồi lời mời", ariaLabel: `Thu hồi lời mời tới ${inv.email}`, danger: true, testId: "go-invite-revoke", onSelect: () => setTarget({ kind: "invite", id: inv.id, email: inv.email ?? "", role: inv.role ?? "" }) }]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <InviteDrawer
        open={inviteOpen}
        branches={scope.gyms}
        onClose={() => setInviteOpen(false)}
        onSent={(r) => {
          setCreated(r);
          reload();
        }}
        onFailedUnclear={reload}
        onDirty={onDirty}
      />

      <GoModal
        open={!!target}
        onClose={() => {
          if (phase !== "working") closeTarget();
        }}
        closeOnBackdrop={false}
        closeOnEscape={phase !== "working"}
        tone="risk"
        testId="go-staff-revoke"
        title={copy?.title ?? "Thu hồi"}
        description={copy?.body}
        footer={
          <>
            <button type="button" className="go-btn" onClick={closeTarget} disabled={phase === "working"}>Giữ lại</button>
            <button type="button" className="go-btn" data-variant="danger" onClick={() => void confirmRevoke()} disabled={phase !== "idle"} data-testid="go-staff-revoke-go">
              <SuccessCheck show={phase === "done"} />
              <TextStates value={phase === "working" ? "Đang thu hồi" : phase === "done" ? "Đã thu hồi" : (copy?.confirm ?? "Thu hồi")} />
            </button>
          </>
        }
      >
        <div ref={shake.ref} className="go-form-box">
          {dialogError && <p className="go-error" role="alert" data-testid="go-staff-revoke-error">{dialogError}</p>}
        </div>
      </GoModal>

      {/* The legacy "invite created" box: the link is shown here once, right after the 2xx, with a copy button. Never logged. */}
      <GoModal
        open={!!created}
        onClose={() => setCreated(null)}
        testId="invite-created-modal"
        title={created ? `Đã gửi lời mời tới ${created.email}` : "Đã gửi lời mời"}
        description={created ? (created.emailSent ? "Email đã được gửi." : "Không gửi được email tự động. Hãy sao chép liên kết dưới đây và gửi cho người được mời.") : undefined}
        footer={<button type="button" className="go-btn" onClick={() => setCreated(null)}>Đóng</button>}
      >
        {created && created.inviteLink && (
          <div className="go-copy-row">
            <code className="go-code" data-testid="go-invite-link">{created.inviteLink}</code>
            <button
              type="button"
              className="go-icon-btn"
              aria-label="Sao chép liên kết mời"
              onClick={() => {
                navigator.clipboard?.writeText(created.inviteLink).catch(() => {});
                toast.success("Đã sao chép");
              }}
            >
              <CopyIcon aria-hidden="true" width={16} height={16} />
            </button>
          </div>
        )}
      </GoModal>
    </div>
  );
}
