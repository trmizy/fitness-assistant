/**
 * Agreement drawer (07 panel-reveal) of the OWNER's Đối tác PT. Opened by `?agreement=<id>`, so Back and a deep link work.
 *
 * What it shows is what the API really sends: the current terms (three stored fractions, shown exactly), the round, expiry /
 * effective / termination dates, the branches a brand agreement covers, the note. The API sends NO proposal history and no maximum
 * number of rounds, so none is drawn (a short line says so instead of inventing rows).
 *
 * Actions are exactly the old CollaborationPanel ones, through the same service calls, and every one asks first in a dialog that
 * says it applies to the whole brand (or to one branch for an old per-branch term):
 *  - MY_TURN        : Chấp nhận (`respond ACCEPT`), Đề xuất lại (`respond COUNTER` + rates), Từ chối (`respond REJECT`)
 *  - ACTIVE         : Chấm dứt hợp tác (`terminate`, notice period decided by the server)
 *  - TERMINATED     : Hợp tác lại (opens the propose drawer pre-filled)
 *  - legacy branch rows: the same, per row (a legacy offer at a branded gym can only be turned down), and "Đề xuất thỏa thuận chung"
 * The success check (10) is drawn ONLY after a 2xx; a refusal shows the server's own sentence (12 shake) and never the check.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { collaborationService } from "../../../services/api";
import {
  COVERAGE_COPY,
  PT_NAME_FALLBACK,
  SIGNED_CONTRACTS_NOTE,
  LEGACY_OPEN_OFFER_NOTE,
  ratesLine,
  terminateBrandCopy,
  terminatedToast,
  type BrandAgreementView,
  type LegacyGroupView,
  type LegacyRowView,
} from "../../../utils/brandPartnership";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { DrawerSection, GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { RatesFields } from "./RatesFields";
import {
  PT_INDEPENDENT_NOTE,
  collabErrorMessage,
  collabErrorNeedsReload,
  percentFieldFrom,
  ratePercent,
  ratesState,
  toTagTone,
  type PartnerRow,
} from "./partnersModel";

type Phase = "idle" | "sending" | "done";

type Dlg =
  | { kind: "accept" | "reject"; id: string; title: string; lines: string[]; ratesText: string | null }
  | { kind: "counter"; id: string; title: string; round: number; pt: string | null; gym: string | null; branchOnly: boolean; scopeText: string }
  | { kind: "terminate"; id: string; title: string; lines: string[]; immediate: boolean };

export interface ProposeInit {
  brandId?: string;
  ptUserId: string;
  ptName: string;
  doorBranchId?: string;
  repartner?: boolean;
}

export function AgreementDrawer({
  open,
  row,
  loaded,
  ptName,
  onClose,
  onChanged,
  onPropose,
}: {
  open: boolean;
  row: PartnerRow | null;
  /** The list has been fetched: a missing row is then "not found", before that it is still loading. */
  loaded: boolean;
  /** Name of the trainer (never an id); falls back to a plain word. */
  ptName: string;
  onClose: () => void;
  /** Called after a 2xx so the page refreshes its lists. */
  onChanged: () => void;
  onPropose: (init: ProposeInit) => void;
}) {
  const last = useRef<PartnerRow | null>(null);
  useEffect(() => {
    if (row) last.current = row;
  }, [row]);
  const shown = row ?? last.current;

  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ptPct, setPtPct] = useState("");
  const [gymPct, setGymPct] = useState("");
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Another agreement, or the drawer closing (Back included), drops every dialog: nothing typed here is worth asking about.
  useEffect(() => {
    setDlg(null);
    setPhase("idle");
    setRefusal(null);
  }, [row?.key, open]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const respond = useMutation({
    mutationFn: (v: { id: string; action: "ACCEPT" | "REJECT" | "COUNTER"; body?: { ptRate: string; gymRate: string; platformRate: string } }) =>
      collaborationService.respond(v.id, "GYM", { action: v.action, ...(v.body ?? {}) }),
  });
  const terminate = useMutation({ mutationFn: (id: string) => collaborationService.terminate(id, "GYM") });

  const counterRates = ratesState(ptPct, gymPct);

  const openCounter = (d: Extract<Dlg, { kind: "counter" }>) => {
    setPtPct(percentFieldFrom(d.pt, "55"));
    setGymPct(percentFieldFrom(d.gym, "35"));
    setRefusal(null);
    setDlg(d);
  };

  const finish = (message: string) => {
    setPhase("done");
    toast.success(message);
    onChanged();
    timer.current = setTimeout(() => {
      setDlg(null);
      setPhase("idle");
    }, 900);
  };
  const fail = (err: unknown) => {
    setPhase("idle");
    setRefusal(collabErrorMessage(err));
    shake.shake();
    if (collabErrorNeedsReload(err)) onChanged();
  };

  const send = async () => {
    if (!dlg || phase !== "idle") return;
    setRefusal(null);
    if (dlg.kind === "counter" && !counterRates.body) return;
    setPhase("sending");
    try {
      if (dlg.kind === "terminate") {
        const result = await terminate.mutateAsync(dlg.id);
        finish(terminatedToast(result));
      } else if (dlg.kind === "counter") {
        await respond.mutateAsync({ id: dlg.id, action: "COUNTER", body: counterRates.body! });
        finish("Đã gửi đề xuất mới");
      } else {
        await respond.mutateAsync({ id: dlg.id, action: dlg.kind === "accept" ? "ACCEPT" : "REJECT" });
        finish(dlg.kind === "accept" ? "Đã chấp nhận hợp tác" : "Đã từ chối");
      }
    } catch (err) {
      fail(err);
    }
  };

  const closeDialog = () => {
    if (phase === "sending") return;
    setDlg(null);
    setRefusal(null);
    setPhase("idle");
  };

  const who = ptName || PT_NAME_FALLBACK;

  // ------------------------------------------------------------------ action buttons
  const brandActions = (c: BrandAgreementView) => {
    const scopeLine = `Áp dụng toàn thương hiệu ${c.brandName}: mọi chi nhánh đang mở và chi nhánh mở sau này.`;
    const rates = ratesLine(c.rates);
    if (c.canRespond) {
      return (
        <div className="go-btn-row">
          <button type="button" className="go-btn" data-variant="primary" data-testid="go-agr-accept" onClick={() => { setRefusal(null); setDlg({ kind: "accept", id: c.id, title: `Chấp nhận thỏa thuận với ${who}?`, lines: [scopeLine, "Hợp đồng đã ký giữ nguyên tỷ lệ lúc ký."], ratesText: rates }); }}>Chấp nhận</button>
          <button type="button" className="go-btn" data-testid="go-agr-counter" onClick={() => openCounter({ kind: "counter", id: c.id, title: who, round: c.round, pt: c.raw.pt, gym: c.raw.gym, branchOnly: false, scopeText: "Bộ tỷ lệ này áp dụng cho mọi chi nhánh của thương hiệu." })}>Đề xuất lại</button>
          <button type="button" className="go-btn" data-tone="risk" data-testid="go-agr-reject" onClick={() => { setRefusal(null); setDlg({ kind: "reject", id: c.id, title: `Từ chối đề xuất của ${who}?`, lines: [scopeLine, "PT sẽ nhận được thông báo từ chối. Bạn có thể mời lại sau."], ratesText: rates }); }}>Từ chối</button>
        </div>
      );
    }
    if (c.canTerminate) {
      return (
        <div className="go-btn-row">
          <button type="button" className="go-btn" data-tone="risk" data-testid="go-agr-terminate" onClick={() => { const copy = terminateBrandCopy("GYM", who === PT_NAME_FALLBACK ? "" : who); setRefusal(null); setDlg({ kind: "terminate", id: c.id, title: copy.title, lines: [`Thỏa thuận này áp dụng toàn thương hiệu ${c.brandName}, nên chấm dứt là chấm dứt ở mọi chi nhánh.`, ...copy.lines], immediate: false }); }}>Chấm dứt hợp tác</button>
        </div>
      );
    }
    if (c.canRepartner) {
      return (
        <div className="go-btn-row">
          <button type="button" className="go-btn" data-variant="primary" data-testid="go-agr-repartner" onClick={() => onPropose({ brandId: c.brandId, ptUserId: c.ptUserId, ptName: who, doorBranchId: c.proposeBranchId ?? undefined, repartner: true })}>Hợp tác lại</button>
        </div>
      );
    }
    if (c.stage === "THEIR_TURN") return <p className="go-muted" data-testid="go-agr-waiting">Đang chờ PT trả lời, bạn chưa cần làm gì. Bên vừa đề xuất không tự chấp nhận được đề xuất của mình.</p>;
    if (c.stage === "TERMINATING") return <p className="go-muted">Đang trong thời gian báo trước chấm dứt, không còn hành động nào.</p>;
    return <p className="go-muted">Thỏa thuận này đã kết thúc{c.canRepartner ? "" : ", chưa có thể hợp tác lại từ đây"}.</p>;
  };

  const legacyRow = (g: LegacyGroupView, r: LegacyRowView) => {
    const rowScope = g.branded ? `Chỉ áp dụng riêng cho chi nhánh ${r.branchName} (điều khoản cũ).` : `Chỉ áp dụng riêng cho chi nhánh ${r.branchName} (phòng gym chưa có thương hiệu).`;
    return (
      <div key={r.id} className="go-agr-legacy" data-testid="go-agr-legacy-row">
        <div className="go-agr-legacy-head">
          <strong>{r.branchName}</strong>
          <GoTag tone={toTagTone(r.tone)} text={r.label} />
        </div>
        <p className="go-muted-text">{r.ratesCaption}: {ratesLine(r.rates)}</p>
        {r.stage === "TERMINATING" && r.effectiveDate && <p className="go-muted-text">Đang chấm dứt, hiệu lực đến {r.effectiveDate}.</p>}
        {r.stage === "MY_TURN" && !r.canAcceptOrCounter && <p className="go-muted-text">{LEGACY_OPEN_OFFER_NOTE}</p>}
        <div className="go-btn-row">
          {r.canAcceptOrCounter && (
            <>
              <button type="button" className="go-btn go-btn-sm" data-variant="primary" data-testid="go-agr-accept" onClick={() => { setRefusal(null); setDlg({ kind: "accept", id: r.id, title: `Chấp nhận thỏa thuận với ${who}?`, lines: [rowScope, "Hợp đồng đã ký giữ nguyên tỷ lệ lúc ký."], ratesText: ratesLine(r.rates) }); }}>Chấp nhận</button>
              <button type="button" className="go-btn go-btn-sm" data-testid="go-agr-counter" onClick={() => openCounter({ kind: "counter", id: r.id, title: r.branchName, round: r.round, pt: r.raw.pt, gym: r.raw.gym, branchOnly: !g.branded, scopeText: !g.branded ? "Tỷ lệ này chỉ áp dụng riêng cho chi nhánh này." : "Bộ tỷ lệ này áp dụng cho mọi chi nhánh của thương hiệu." })}>Đề xuất lại</button>
            </>
          )}
          {r.canReject && (
            <button type="button" className="go-btn go-btn-sm" data-tone="risk" data-testid="go-agr-reject" onClick={() => { setRefusal(null); setDlg({ kind: "reject", id: r.id, title: `Từ chối đề xuất cũ của ${r.branchName}?`, lines: [rowScope, "PT sẽ nhận được thông báo từ chối."], ratesText: ratesLine(r.rates) }); }}>Từ chối</button>
          )}
          {r.canTerminate && (
            <button type="button" className="go-btn go-btn-sm" data-tone="risk" data-testid="go-agr-terminate" onClick={() => { setRefusal(null); setDlg({ kind: "terminate", id: r.id, title: r.terminateCopy.title, lines: r.terminateCopy.lines, immediate: true }); }}>{r.terminateLabel}</button>
          )}
        </div>
      </div>
    );
  };

  const card = shown?.card ?? null;
  const dialogBusy = phase === "sending";
  const dialogTitle = dlg ? (dlg.kind === "counter" ? `Đề xuất lại (vòng ${dlg.round + 1})` : dlg.title) : "";
  const doneLabel = dlg?.kind === "terminate" ? "Đã chấm dứt" : dlg?.kind === "accept" ? "Đã chấp nhận" : dlg?.kind === "reject" ? "Đã từ chối" : "Đã gửi";
  const confirmLabel = dlg?.kind === "terminate" ? "Chấm dứt" : dlg?.kind === "accept" ? "Chấp nhận" : dlg?.kind === "reject" ? "Từ chối" : "Gửi đề xuất";
  const doingLabel = dlg?.kind === "terminate" ? "Đang chấm dứt" : "Đang gửi";
  const variant = dlg?.kind === "terminate" || dlg?.kind === "reject" ? "danger" : "primary";

  return (
    <>
      <GoDrawer
        open={open}
        onClose={onClose}
        busy={dialogBusy}
        title={shown ? who : "Thỏa thuận PT"}
        description="Chi tiết một thỏa thuận chia doanh thu với huấn luyện viên và các hành động của chủ phòng tập."
        testId="go-agreement-drawer"
        meta={shown ? <><GoTag tone={shown.tag.tone} text={shown.tag.text} /><span>{shown.scopeLine}</span></> : undefined}
      >
        {!shown && <p className="go-muted" role="status" data-testid="go-agr-missing">{loaded ? "Không tìm thấy thỏa thuận này. Có thể nó đã được xử lý ở nơi khác." : "Đang tải thỏa thuận…"}</p>}
        {shown && card && (
          <>
            <DrawerSection title={card.kind === "BRAND" ? "Tỷ lệ hiện tại" : "Điều khoản của từng chi nhánh"}>
              {card.kind === "BRAND" ? (
                <>
                  <dl className="go-kv" data-testid="go-agr-rates">
                    <div><dt>PT</dt><dd data-testid="go-agr-rate-pt">{ratePercent(card.raw.pt)}</dd></div>
                    <div><dt>Phòng tập</dt><dd data-testid="go-agr-rate-gym">{ratePercent(card.raw.gym)}</dd></div>
                    <div><dt>Nền tảng</dt><dd data-testid="go-agr-rate-platform">{ratePercent(card.raw.platform)}</dd></div>
                    {(card.stage === "MY_TURN" || card.stage === "THEIR_TURN") && <div><dt>Vòng</dt><dd data-testid="go-agr-round">Vòng {card.round}</dd></div>}
                    <div><dt>Hiệu lực</dt><dd data-testid="go-agr-effect">{shown.effectText}</dd></div>
                  </dl>
                  <p className="go-dsec-note">{COVERAGE_COPY}</p>
                  <p className="go-dsec-note">{SIGNED_CONTRACTS_NOTE}</p>
                  {card.noticeLine && <p className="go-hint" data-tone="warn" data-testid="go-agr-notice">Đang chấm dứt, hiệu lực đến {card.effectiveDate}. {card.noticeLine}</p>}
                  {card.note && <p className="go-quote">{card.note}</p>}
                </>
              ) : (
                <>
                  <p className="go-hint" data-tone="warn" data-testid="go-agr-legacy-headline"><span><strong>{card.headline}</strong>{card.detail ? <><br />{card.detail}</> : null}</span></p>
                  <div className="go-agr-legacy-list">{card.rows.map((r) => legacyRow(card, r))}</div>
                </>
              )}
            </DrawerSection>

            {card.kind === "BRAND" && card.branches.length > 0 && (
              <DrawerSection title={`Chi nhánh áp dụng (${card.branches.length})`}>
                <ul className="go-agr-branches" data-testid="go-agr-branches">
                  {card.branches.map((b) => (
                    <li key={b.id}>{b.name}{b.closed ? " · tạm đóng" : ""}</li>
                  ))}
                </ul>
                <p className="go-dsec-note">Không có tỷ lệ riêng cho từng chi nhánh.</p>
              </DrawerSection>
            )}

            <DrawerSection title="Lịch sử đề xuất">
              <p className="go-dsec-note" data-testid="go-agr-nohistory">Máy chủ chỉ trả đề xuất hiện tại, chưa trả từng vòng đã qua và chưa nêu số vòng tối đa, nên màn này không dựng lại lịch sử.</p>
            </DrawerSection>

            <DrawerSection title="Hành động" tone="decision">
              {card.kind === "BRAND" ? brandActions(card) : (
                <>
                  {card.canProposeJoint && (
                    <div className="go-btn-row">
                      <button type="button" className="go-btn" data-variant="primary" data-testid="go-agr-propose-joint" onClick={() => onPropose({ brandId: card.brandId ?? undefined, ptUserId: card.ptUserId, ptName: who, doorBranchId: card.proposeBranchId ?? undefined })}>Đề xuất thỏa thuận chung cho thương hiệu</button>
                    </div>
                  )}
                  {!card.canProposeJoint && <p className="go-muted">Hành động nằm ở từng chi nhánh phía trên.</p>}
                </>
              )}
              <p className="go-dsec-note" data-testid="go-agr-independent">{PT_INDEPENDENT_NOTE}</p>
            </DrawerSection>
          </>
        )}
      </GoDrawer>

      <GoModal
        open={!!dlg}
        onClose={closeDialog}
        closeOnBackdrop={false}
        closeOnEscape={!dialogBusy}
        tone={variant === "danger" ? "risk" : "default"}
        testId="go-agr-confirm"
        title={dialogTitle}
        footer={
          <>
            <button type="button" className="go-btn" onClick={closeDialog} disabled={dialogBusy} data-testid="go-agr-confirm-cancel">Quay lại</button>
            <button
              type="button"
              className="go-btn"
              data-variant={variant}
              onClick={() => void send()}
              disabled={phase !== "idle" || (dlg?.kind === "counter" && !counterRates.ok)}
              data-testid="go-agr-confirm-send"
            >
              <SuccessCheck show={phase === "done"} />
              <TextStates value={phase === "sending" ? doingLabel : phase === "done" ? doneLabel : confirmLabel} />
            </button>
          </>
        }
      >
        <div ref={shake.ref} className="go-confirm-who">
          {dlg && dlg.kind !== "counter" && (
            <>
              {"ratesText" in dlg && dlg.ratesText && <p className="go-quote" data-testid="go-agr-confirm-rates">{dlg.ratesText}</p>}
              <ul className="go-rule-list" data-testid="go-agr-confirm-lines">
                {dlg.lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </>
          )}
          {dlg?.kind === "counter" && (
            <>
              <p className="go-muted-text">{dlg.title}</p>
              <RatesFields pt={ptPct} gym={gymPct} onPt={setPtPct} onGym={setGymPct} state={counterRates} scopeNote={dlg.scopeText} idPrefix="go-counter" />
            </>
          )}
          {refusal && <p className="go-result" data-tone="risk" role="alert" data-testid="go-agr-refusal">{refusal}</p>}
        </div>
      </GoModal>
    </>
  );
}
