/**
 * Exception drawer (07 panel-reveal): part A is the investigation (member, requester, reason, created at, expiry, the member's recent
 * check-ins from the branch's latest 50, the rules), part B is the decision (owner / manager only, and never on a request made by
 * the viewer). The decision uses the existing API unchanged: `gymService.decideCheckinException(gymId, id, "approve"|"reject", reason)`
 * with a reason of 5-300 characters (counted). A confirmation dialog names the branch and the member; 403 self-approval, 409 and 410
 * are answered in plain Vietnamese (frontDeskModel.decisionRefusal), codes are never shown.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { gymService } from "../../../services/api";
import type { ExceptionRow } from "../../../utils/assistedCheckin";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { DrawerSection, GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCodes, goKey } from "../scope/scopeModel";
import { CHECKIN_LIMIT_NOTE, checkinSourceLabel, checkinsOfMembership, formatStamp } from "../members/membersModel";
import {
  EXCEPTION_NOT_FOUND_NOTE,
  EXCEPTION_RULES,
  REASON_MAX,
  canDecide,
  confirmBody,
  confirmTitle,
  decisionRefusal,
  exceptionTag,
  expiryText,
  isOpenPending,
  reasonCounter,
  reasonProblem,
  verbLabel,
  type DecisionRefusal,
  type DecisionVerb,
} from "./frontDeskModel";

type Phase = "idle" | "sending" | "done";

export function ExceptionDrawer({
  open,
  row,
  loaded,
  canApprove,
  gymId,
  gymName,
  uid,
  onClose,
  onDirtyChange,
}: {
  open: boolean;
  row: ExceptionRow | null;
  /** The list has been fetched: a missing row is then "not found", before that it is still loading. */
  loaded: boolean;
  canApprove: boolean;
  gymId: string;
  gymName: string;
  uid: string;
  /** `force`: the drawer already asked and the user chose to discard, so the page must not ask again. */
  onClose: (force?: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const scope = useGymOwnerScope();
  const queryClient = useQueryClient();
  const last = useRef<ExceptionRow | null>(null);
  useEffect(() => {
    if (row) last.current = row;
  }, [row]);
  const shown = row ?? last.current;

  const [reason, setReason] = useState("");
  const [verb, setVerb] = useState<DecisionVerb | null>(null); // the confirmation dialog is open for this verb
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState<DecisionRefusal | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different request (or the drawer reopening) starts clean.
  useEffect(() => {
    setReason("");
    setVerb(null);
    setPhase("idle");
    setRefusal(null);
    setAskDiscard(false);
  }, [row?.id, open]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const dirty = open && phase !== "done" && reason.trim().length > 0;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check-ins of the member: only owner / manager rows carry a membership id (the receptionist's list has names and times only).
  const identifiable = scope.can("membership.full");
  const checkinsQ = useQuery<{ scopeKey: string; raw: unknown }>({
    queryKey: goKey(scope, "checkins"),
    queryFn: async () => ({ scopeKey: scope.scopeKey, raw: await gymService.listCheckins(gymId) }),
    enabled: open && !!shown && identifiable,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; verb: DecisionVerb; reason: string }) => gymService.decideCheckinException(gymId, v.id, v.verb, v.reason),
  });

  const nowMs = Date.now();
  const code = branchCodes(scope.gyms)[gymId];

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ["frontdesk-exceptions", uid, gymId] });
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "gym-owner" && q.queryKey[1] === scope.userId && typeof q.queryKey[5] === "string" && (q.queryKey[5] as string).startsWith("today:") });
  };

  const send = async () => {
    if (!shown || !verb || phase === "sending") return;
    const v = verb;
    setRefusal(null);
    setPhase("sending");
    try {
      await decide.mutateAsync({ id: shown.id, verb: v, reason: reason.trim() });
      setPhase("done"); // 2xx only
      toast.success(v === "approve" ? "Đã duyệt ngoại lệ" : "Đã từ chối ngoại lệ");
      refreshLists();
      timer.current = setTimeout(() => {
        setVerb(null);
        setReason("");
        setPhase("idle");
      }, 900);
    } catch (err) {
      const r = decisionRefusal(err);
      setPhase("idle");
      setRefusal(r);
      shake.shake();
      if (r.reload) refreshLists();
    }
  };

  const requestClose = () => {
    if (phase === "sending") return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  const tag = shown ? exceptionTag(shown.status) : null;
  const items = shown && checkinsQ.data && checkinsQ.data.scopeKey === scope.scopeKey ? checkinsOfMembership(checkinsQ.data.raw, shown.membershipId || null) : [];
  const pending = shown ? isOpenPending(shown, nowMs) : false;
  const mayDecide = !!shown && canDecide(scope.can, canApprove);
  const problem = reasonProblem(reason);
  const L = verb ? verbLabel(verb) : null;

  return (
    <>
      <GoDrawer
        open={open}
        onClose={requestClose}
        busy={phase === "sending"}
        title={shown ? `Ngoại lệ của ${shown.displayName}` : "Ngoại lệ check-in"}
        description="Chi tiết một yêu cầu ngoại lệ check-in: thông tin để điều tra và quyết định."
        testId="go-exception-drawer"
        meta={
          <>
            {tag && <GoTag tone={tag.tone} text={tag.text} />}
            {code && <span className="go-code-chip" aria-hidden="true">{code}</span>}
            <span>{gymName}</span>
          </>
        }
      >
        {!shown && (
          <p className="go-muted" role="status" data-testid="go-exception-missing">{loaded ? EXCEPTION_NOT_FOUND_NOTE : "Đang tải yêu cầu…"}</p>
        )}
        {shown && (
          <>
            <DrawerSection title="Thông tin để điều tra">
              <dl className="go-kv">
                <div><dt>Hội viên</dt><dd>{shown.displayName}{shown.memberCode ? `, ${shown.memberCode}` : ""}</dd></div>
                {shown.planName && <div><dt>Gói</dt><dd>{shown.planName}</dd></div>}
                <div><dt>Người xin</dt><dd>{shown.requestedByName}{shown.mine ? " (bạn)" : ""}</dd></div>
                <div><dt>Lý do xin</dt><dd data-testid="go-exception-reason">{shown.requestReason}</dd></div>
                <div><dt>Tạo lúc</dt><dd>{formatStamp(shown.createdAt)}</dd></div>
                <div><dt>Hết hạn</dt><dd>{expiryText(shown, nowMs)}</dd></div>
              </dl>
            </DrawerSection>

            <DrawerSection title="Check-in gần đây của hội viên">
              {!identifiable && <p className="go-muted">Lễ tân không xem được lịch sử check-in theo hội viên.</p>}
              {identifiable && checkinsQ.isLoading && <p className="go-muted">Đang tải check-in…</p>}
              {identifiable && checkinsQ.isError && <p className="go-field-error" role="alert">Không tải được check-in của chi nhánh. Không kết luận là chưa có lượt nào.</p>}
              {identifiable && !checkinsQ.isLoading && !checkinsQ.isError && items.length === 0 && <p className="go-muted" data-testid="go-exception-checkins-empty">Không có lượt nào của hội viên này trong 50 lượt gần nhất của chi nhánh.</p>}
              {items.length > 0 && (
                <ul className="go-ci-list" data-testid="go-exception-checkins">
                  {items.map((c) => (
                    <li key={c.id}><span>{formatStamp(c.at)}</span><span>{checkinSourceLabel(c.source)}</span></li>
                  ))}
                </ul>
              )}
              {identifiable && <p className="go-dsec-note">{CHECKIN_LIMIT_NOTE}</p>}
            </DrawerSection>

            <DrawerSection title="Luật áp dụng">
              <ul className="go-rule-list" data-testid="go-exception-rules">
                {EXCEPTION_RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </DrawerSection>

            <DrawerSection title="Quyết định" tone="decision">
              {shown.status !== "PENDING" && (
                <p data-testid="go-exception-decided">
                  {shown.status === "APPROVED" || shown.status === "USED" || shown.status === "REJECTED"
                    ? `${shown.decidedByName ?? "Quản lý"} đã ${shown.status === "REJECTED" ? "từ chối" : "duyệt"}${shown.decisionReason ? `: ${shown.decisionReason}` : "."}`
                    : "Yêu cầu này đã hết hạn và không còn quyết định được."}
                </p>
              )}
              {shown.status === "PENDING" && !mayDecide && (
                <p className="go-muted" data-testid="go-exception-nodecide">
                  {scope.can("checkin.exception.request") && !scope.can("checkin.exception.approve") ? "Chỉ quản lý hoặc chủ phòng tập duyệt được ngoại lệ. Bạn xem để theo dõi yêu cầu của mình." : "Bạn không có quyền duyệt ngoại lệ ở chi nhánh này."}
                </p>
              )}
              {shown.status === "PENDING" && mayDecide && shown.mine && (
                <p className="go-muted" data-testid="go-exception-mine">Yêu cầu do chính bạn tạo, cần người khác duyệt. Người duyệt phải khác người xin.</p>
              )}
              {shown.status === "PENDING" && mayDecide && !shown.mine && !pending && (
                <p className="go-muted" data-testid="go-exception-expired">Yêu cầu này đã quá hạn trong ngày nên không còn duyệt được.</p>
              )}
              {shown.status === "PENDING" && mayDecide && !shown.mine && pending && (
                <div className="go-form-box">
                  <label className="go-field" data-error={reason.length > REASON_MAX ? "true" : undefined}>
                    <span className="go-label">Lý do của bạn (5 đến 300 ký tự)</span>
                    <textarea
                      className="go-input go-textarea"
                      rows={3}
                      aria-label="Lý do duyệt hoặc từ chối"
                      aria-invalid={reason.length > REASON_MAX ? true : undefined}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Bạn đã xác minh bằng cách nào, hoặc vì sao từ chối?"
                      data-testid="go-exception-reason-input"
                    />
                    <span className="go-counter" data-over={reason.length > REASON_MAX ? "true" : undefined} data-testid="go-exception-counter" aria-live="polite">{reasonCounter(reason)}</span>
                  </label>
                  <div className="go-drawer-foot-row">
                    <button type="button" className="go-btn" data-variant="primary" disabled={problem !== null} onClick={() => setVerb("approve")} data-testid="go-exception-approve">Duyệt</button>
                    <button type="button" className="go-btn" disabled={problem !== null} onClick={() => setVerb("reject")} data-testid="go-exception-reject">Từ chối</button>
                  </div>
                  {reason.trim().length > 0 && problem && <p className="go-hint-text" role="status">{problem}</p>}
                </div>
              )}
            </DrawerSection>
          </>
        )}
      </GoDrawer>

      <GoModal
        open={!!verb && !!shown}
        onClose={() => {
          if (phase !== "sending") {
            setVerb(null);
            setRefusal(null);
          }
        }}
        closeOnBackdrop={false}
        closeOnEscape={phase !== "sending"}
        tone={verb === "reject" ? "risk" : "default"}
        testId="go-exception-confirm"
        title={shown && verb ? confirmTitle(verb, shown.displayName, gymName) : ""}
        description={verb ? confirmBody(verb) : undefined}
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => { setVerb(null); setRefusal(null); }} disabled={phase === "sending"}>
              {refusal && !refusal.retry ? "Đóng" : "Quay lại"}
            </button>
            {!(refusal && !refusal.retry) && L && (
              <button type="button" className="go-btn" data-variant={verb === "reject" ? "danger" : "primary"} onClick={() => void send()} disabled={phase !== "idle"} data-testid="go-exception-confirm-send">
                <SuccessCheck show={phase === "done"} />
                <TextStates value={phase === "sending" ? L.doing : phase === "done" ? L.done : L.confirm} />
              </button>
            )}
          </>
        }
      >
        <div ref={shake.ref} className="go-confirm-who">
          {shown && (
            <dl className="go-kv">
              <div><dt>Chi nhánh</dt><dd data-testid="go-exception-confirm-branch">{gymName}</dd></div>
              <div><dt>Hội viên</dt><dd data-testid="go-exception-confirm-member">{shown.displayName}</dd></div>
              <div><dt>Người xin</dt><dd>{shown.requestedByName}</dd></div>
            </dl>
          )}
          <p className="go-label">Lý do của bạn</p>
          <p className="go-quote">{reason.trim()}</p>
          {refusal && <p className="go-result" data-tone="risk" role="alert" data-testid="go-exception-refusal">{refusal.text}</p>}
        </div>
      </GoModal>

      <GoModal
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title="Bỏ lý do đang gõ?"
        description="Lý do bạn đã nhập chưa được gửi và sẽ mất."
        testId="go-exception-discard"
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => setAskDiscard(false)}>Tiếp tục</button>
            <button type="button" className="go-btn" data-variant="danger" onClick={() => { setAskDiscard(false); setReason(""); onClose(true); }}>Bỏ và đóng</button>
          </>
        }
      />
    </>
  );
}
