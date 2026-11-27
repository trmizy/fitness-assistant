/**
 * One complaint case in a drawer (07 panel-reveal), opened by the deep link `/gym-owner/complaint-cases/:caseId`.
 * Reads `GET /owner/complaint-cases/:id` exactly as the legacy page did (never polled: every read writes access-log rows on the server).
 * Sections: Tóm tắt, Dòng thời gian, Giải trình, Bằng chứng, Kết quả, then the two legacy forms (`GymStatementForm`,
 * `GymDocumentForm`) wrapped UNTOUCHED with the same submit functions. The server decides who may submit (`case.canSubmit`).
 * No button exists for the decision, the appeal or the refund: those belong to Gymini.
 * Closing with something typed in a form asks first (the page also guards Back / another case / another branch with useBlocker).
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gymCaseApi } from "../../../pages/admin/complaints/gymCaseApi";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "../../../pages/admin/complaints/gymCaseQueryKeys";
import { parseGymCaseId } from "../../../pages/admin/complaints/gymCaseModel";
import { GymStatementForm, GymDocumentForm } from "../../../pages/complaints/GymMemberForms";
import { issueLabel } from "../../../pages/admin/complaints/gymCaseLabels";
import { DrawerSection, GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { GoAccordion } from "../../../components/layout/gym-owner/GoAccordion";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { SuccessCheck, TextStates } from "../../../components/layout/gym-owner/motion";
import { dayText, stamp } from "../finance/financeModel";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCodes } from "../scope/scopeModel";
import { CLOSED_NOTE, IDENTITY_NOTE, RESULT_NOTE, caseProblem, caseTimeline, dueOf, evidenceView, hasTypedContent, moreInfoText, taskOf } from "./casesModel";

export function CaseDrawer({
  caseId: raw,
  onClose,
  forceClose,
  formsRef,
}: {
  caseId: string | null;
  /** Asks (inside the drawer) before dropping typed text, then closes. */
  onClose: () => void;
  /** Closes without asking again (the person already confirmed). */
  forceClose: () => void;
  /** The wrapper of the two legacy forms, read by the page's leave guard. */
  formsRef: React.RefObject<HTMLDivElement>;
}) {
  const scope = useGymOwnerScope();
  const { keys } = useGymQueryKeys();
  const queryClient = useQueryClient();
  const open = raw !== null;
  const caseId = parseGymCaseId(raw);
  const [askDiscard, setAskDiscard] = useState(false);
  const [saved, setSaved] = useState<"statement" | "document" | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codes = branchCodes(scope.gyms);

  const query = useQuery({
    queryKey: keys && caseId ? keys.ownerDetail(caseId) : ["gym-complaint", "disabled", "owner-detail"],
    queryFn: () => gymCaseApi.getOwner(caseId as string),
    enabled: !!keys && !!caseId && open,
    ...GYM_QUERY_OPTIONS,
  });
  const d = query.data && query.data.case.id === caseId ? query.data : undefined;
  const problem = query.isError && !d ? caseProblem(query.error, "detail") : null;

  const requestClose = () => {
    if (hasTypedContent(formsRef.current)) setAskDiscard(true);
    else onClose();
  };

  const onSaved = (kind: "statement" | "document") => {
    // Only reached after the server answered 2xx (the legacy forms call it on success only).
    void query.refetch();
    if (keys) void queryClient.invalidateQueries({ queryKey: keys.ownerList() });
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "gym-owner" && q.queryKey[1] === scope.userId && q.queryKey[5] === "complaints" });
    setSaved(kind);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), 5000);
  };

  const gymName = d ? (scope.gyms.find((g) => g.id === d.case.gymId)?.name ?? null) : null;
  const task = d ? taskOf({ awaitingYou: !!d.moreInfo && (d.moreInfo.askedParties ?? []).includes("GYM"), canSubmit: d.case.canSubmit }) : null;
  const due = d ? dueOf(d.case.respondBy, Date.now()) : null;
  const more = d ? moreInfoText(d.moreInfo) : null;
  const myStatements = d ? d.statements.filter((s) => s.mine).length : 0;

  return (
    <>
      <GoDrawer
        open={open}
        onClose={requestClose}
        title="Hồ sơ khiếu nại"
        description="Nội dung phản ánh, bằng chứng, giải trình và tiến độ của một hồ sơ khiếu nại về chi nhánh của bạn."
        testId="go-case-drawer"
        meta={
          d ? (
            <>
              <span className="go-code-chip" aria-hidden="true">{codes[d.case.gymId] ?? "--"}</span>
              <span className="go-muted">{gymName ?? "Chi nhánh của hồ sơ"}</span>
              {task && <GoTag tone={task.tone} text={task.text} />}
            </>
          ) : undefined
        }
      >
        {!caseId && (
          <p className="go-result" data-tone="risk" role="alert" data-testid="go-case-invalid">
            Đường dẫn hồ sơ không hợp lệ.
          </p>
        )}

        {caseId && query.isLoading && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-case-skeleton">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "60%" }} /><span className="go-skel-bar" style={{ width: "35%" }} /></div>
            ))}
          </div>
        )}

        {problem && (
          <div className="go-state" role="alert" data-testid="go-case-problem" data-kind={problem.kind}>
            <h2>{problem.title}</h2>
            <p>{problem.body}</p>
            <div className="go-state-actions">
              {problem.retry && (
                <button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()} data-testid="go-case-retry">
                  <TextStates value={query.isFetching ? "Đang tải" : "Thử lại"} />
                </button>
              )}
              <button type="button" className="go-btn" onClick={requestClose}>Về danh sách</button>
            </div>
          </div>
        )}

        {d && (
          <div className="go-case" data-testid="go-case-body">
            {more && (
              <div className="go-note" data-tone="warn" role="status" data-testid="go-case-moreinfo">
                <div>
                  <strong>Gymini cần phòng tập giải trình hoặc bổ sung bằng chứng</strong>
                  {d.moreInfo?.note ? <p className="go-prewrap" data-testid="go-case-moreinfo-note">{d.moreInfo.note}</p> : null}
                  <p>{more.who ? `Được hỏi: ${more.who}. ` : ""}{more.due ? `Hạn phản hồi: ${more.due}.` : "Bạn nên phản hồi sớm để hồ sơ được xử lý."}</p>
                </div>
              </div>
            )}

            <DrawerSection title="Tóm tắt">
              <dl className="go-kv" data-testid="go-case-summary">
                <div><dt>Chi nhánh</dt><dd>{gymName ?? "Chi nhánh khác"}</dd></div>
                <div><dt>Loại phản ánh</dt><dd>{issueLabel(d.complaint.issueType)}</dd></div>
                <div><dt>Mở lúc</dt><dd>{stamp(d.case.createdAt) || "Chưa rõ"}</dd></div>
                <div><dt>Hạn phản hồi</dt><dd>{due?.state === "none" ? "Không có hạn đang chạy" : due?.state === "overdue" ? `Đã quá hạn, hạn là ${dayText(d.case.respondBy)}` : dayText(d.case.respondBy)}</dd></div>
              </dl>
              <p className="go-prewrap go-case-desc" data-testid="go-case-description">{d.complaint.description}</p>
            </DrawerSection>

            <DrawerSection title="Dòng thời gian">
              <ol className="go-timeline" data-testid="go-case-timeline">
                {caseTimeline(d).map((t) => (
                  <li key={t.key} data-done={t.done ? "true" : "false"} data-tone={t.tone}>
                    <span className="go-tl-dot" aria-hidden="true" />
                    <div>
                      <p className="go-tl-title">{t.title}</p>
                      {t.at && <p className="go-tl-text">{stamp(t.at)}</p>}
                      {t.text && <p className="go-tl-text">{t.text}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </DrawerSection>

            <DrawerSection title="Giải trình của phòng tập">
              {d.statements.length === 0 ? (
                <p className="go-muted-text" data-testid="go-case-no-statements">Chưa có lời giải trình.</p>
              ) : (
                <ul className="go-case-list" data-testid="go-case-statements">
                  {d.statements.map((s) => (
                    <li key={s.id}>
                      <p className="go-dt-sub">{s.mine ? "Phòng tập đã gửi" : "Nội dung được chia sẻ"}, {stamp(s.createdAt)}</p>
                      <p className="go-quote">{s.text}</p>
                      {s.supplementReason && <p className="go-dt-sub">Lý do bổ sung: {s.supplementReason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>

            <DrawerSection title="Bằng chứng">
              <p className="go-dsec-note">{IDENTITY_NOTE}</p>
              {d.evidence.length === 0 ? (
                <p className="go-muted-text" data-testid="go-case-no-evidence">Chưa có mục nào.</p>
              ) : (
                <ul className="go-case-list" data-testid="go-case-evidence">
                  {d.evidence.map((e) => {
                    const v = evidenceView(e);
                    return (
                      <li key={e.id}>
                        <p className="go-case-ev-title">{e.mine ? "Bằng chứng của phòng tập" : v.title}</p>
                        <p className="go-dt-sub">{stamp(e.capturedAt)}</p>
                        {v.fields.map((f) => (
                          <p key={f.label} className="go-case-ev-field"><span className="go-muted">{f.label}: </span>{f.value}</p>
                        ))}
                        {v.notes.map((n) => <p key={n} className="go-dsec-note">{n}</p>)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </DrawerSection>

            <DrawerSection title="Kết quả">
              <p className="go-case-progress" data-testid="go-case-progress">{d.case.progress}</p>
              <p className="go-dsec-note">{RESULT_NOTE}</p>
            </DrawerSection>

            <DrawerSection title="Gửi cho Gymini">
              {saved && (
                <p className="go-result" data-tone="ok" role="status" data-testid="go-case-saved">
                  <SuccessCheck show size={16} /> {saved === "statement" ? "Đã gửi lời giải trình." : "Đã lưu thông tin tài liệu."} Hồ sơ đã được tải lại.
                </p>
              )}
              {d.case.canSubmit ? (
                <div ref={formsRef} className="go-legacy-form" data-testid="go-case-forms">
                  <GoAccordion title="Gửi lời giải trình" meta={myStatements > 0 ? `${myStatements} lần đã gửi` : undefined} defaultOpen={!!d.moreInfo} testId="go-case-acc-statement">
                    <GymStatementForm caseId={d.case.id} party="gym" statementCount={myStatements} submit={gymCaseApi.submitOwnerExplanation} onSaved={() => onSaved("statement")} />
                  </GoAccordion>
                  <GoAccordion title="Khai báo tài liệu, bằng chứng" testId="go-case-acc-document">
                    <GymDocumentForm caseId={d.case.id} submit={gymCaseApi.submitOwnerEvidence} onSaved={() => onSaved("document")} />
                  </GoAccordion>
                </div>
              ) : (
                <p className="go-note" role="note" data-testid="go-case-closed">{CLOSED_NOTE}</p>
              )}
            </DrawerSection>
          </div>
        )}
      </GoDrawer>

      <GoModal
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title="Bỏ nội dung đang gõ?"
        description="Lời giải trình hoặc thông tin tài liệu bạn đã gõ chưa được gửi và sẽ mất."
        testId="go-case-discard"
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => setAskDiscard(false)}>Tiếp tục soạn</button>
            <button type="button" className="go-btn" data-variant="danger" data-testid="go-case-discard-go" onClick={() => { setAskDiscard(false); forceClose(); }}>Bỏ và đóng</button>
          </>
        }
      />
    </>
  );
}
