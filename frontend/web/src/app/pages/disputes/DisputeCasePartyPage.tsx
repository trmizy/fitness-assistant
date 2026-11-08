import { useCallback } from "react";
import { CompactReference, isReferenceValue } from "../admin/disputes/shared/CompactReference";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { disputeCaseApi } from "../admin/disputes/disputeCaseApi";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import type { PartyCaseDetail } from "../admin/disputes/disputeCaseTypes";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../admin/disputes/disputeQueryKeys";
import { DocumentForm } from "./DocumentForm";
import { StatementForm } from "./StatementForm";
import { PartyAppealForm } from "./PartyAppealForm";
import { PartyAgreementPanel } from "./PartyAgreementPanel";
import { PartyEvidenceFileForm, PartyFileDownload } from "./PartyEvidenceFileForm";
import { BackLink, CARD, FailureBlock, LoadingBlock, MUTED, Notice, Panel, Pill, ReloadButton } from "./PartyParts";
import { partyAllowed, partyRefusal, partyVerdictOf } from "./partyActions";
import { CANNOT_SUBMIT_NOTE, CAN_SUBMIT_NOTE, NOT_FOUND_TEXT, NOT_FOUND_TITLE, NO_AUTO_REFRESH_NOTE, VISIBLE_ONLY_NOTE } from "./partyLabels";
import { accusationViews, caseHeader, evidenceViews, moneyView, nextStatementVersion, parseCaseId, statementViews } from "./partyModel";

function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="d4-not-found">
      <BackLink />
      <div role="alert" className={`${CARD} space-y-1 p-5`}>
        <h1 className="text-lg font-bold">{NOT_FOUND_TITLE}</h1>
        <p className={`text-sm ${MUTED}`}>{NOT_FOUND_TEXT}</p>
      </div>
    </div>
  );
}

/**
 * D4 / M12 - `/disputes/:caseId`: one case as a party sees it (B2 `GET /dispute-cases/:id`) with the statement (B3) and document (B4) forms.
 * What is shown is exactly what the server returned for THIS user (the server already filtered by `evidenceVisibleToParty`); this page
 * never asks for, or hints at, what the other side submitted. Money is the group label only.
 */
export function DisputeCasePartyPage() {
  const params = useParams();
  const caseId = parseCaseId(params.caseId);
  const { keys } = useDisputeQueryKeys();
  const query = useQuery({
    queryKey: keys && caseId ? keys.partyDetail(caseId) : ["dispute-case", "disabled"],
    queryFn: () => disputeCaseApi.getMyCase(caseId as string),
    enabled: !!keys && !!caseId,
    ...DISPUTE_QUERY_OPTIONS,
  });
  const refetch = query.refetch;
  const reload = useCallback(() => refetch(), [refetch]);

  if (!caseId) return <NotFound />;
  const failure = query.isError ? parseDisputeError(query.error) : null;
  if (failure?.kind === "notFound") return <NotFound />;

  const refreshing = query.isFetching && !query.isLoading;
  const detail = query.data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="d4-detail-page">
      <BackLink />

      {query.isLoading && <LoadingBlock testId="d4-detail-loading" />}

      {failure && !detail && (
        <FailureBlock
          testId="d4-detail-failure"
          title="Chưa tải được hồ sơ"
          message={failure.message}
          onRetry={failure.kind === "auth" ? undefined : () => void refetch()}
          retrying={refreshing}
        />
      )}

      {detail && (
        <DetailBody
          detail={detail}
          caseId={caseId}
          refreshing={refreshing}
          refreshFailed={failure?.message ?? null}
          onReload={reload}
        />
      )}
    </div>
  );
}

function DetailBody({
  detail,
  caseId,
  refreshing,
  refreshFailed,
  onReload,
}: {
  detail: PartyCaseDetail;
  caseId: string;
  refreshing: boolean;
  refreshFailed: string | null;
  onReload: () => Promise<unknown>;
}) {
  const head = caseHeader(detail);
  const accusations = accusationViews(detail);
  const evidence = evidenceViews(detail);
  const statements = statementViews(detail);
  const money = moneyView(detail.financial);
  const nextVersion = nextStatementVersion(detail);

  return (
    <>
      <header className={`${CARD} space-y-3 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <h1 className="break-words text-xl font-bold sm:text-2xl" data-testid="d4-detail-title">
              {head.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={head.tone} testId="d4-status">
                {head.statusLabel}
              </Pill>
            </div>
            <p className={`text-sm ${MUTED}`}>
              Bạn là: <span className="text-[var(--text-color)]">{head.roleLabel}</span>
              <span aria-hidden> · </span>
              <span className="whitespace-nowrap">Mở lúc {head.createdLabel}</span>
            </p>
          </div>
          <ReloadButton onClick={() => void onReload()} busy={refreshing} />
        </div>
        <p className="text-sm" data-testid="d4-status-note">
          {head.statusNote}
        </p>
        <p className={`text-xs ${MUTED}`}>{NO_AUTO_REFRESH_NOTE}</p>
        {refreshFailed && (
          <p role="alert" className="text-sm text-st-danger" data-testid="d4-refresh-failed">
            Chưa tải lại được: {refreshFailed} Nội dung bên dưới là lần tải trước.
          </p>
        )}
        <Notice tone={head.canSubmit ? "info" : "pending"} testId="d4-can-submit">
          {head.canSubmit ? CAN_SUBMIT_NOTE : CANNOT_SUBMIT_NOTE}
        </Notice>
      </header>

      <Panel id="d4-claims" title="Nội dung khiếu nại" testId="d4-accusations">
        {accusations.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>Hồ sơ chưa ghi nội dung khiếu nại nào.</p>
        ) : (
          <ul className="space-y-3">
            {accusations.map((a) => (
              <li key={a.id} className="rounded-lg border border-[var(--border-color)] p-3" data-testid="d4-accusation">
                <p className="text-sm font-semibold">{a.who}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.text}</p>
                {a.moves && <p className={`mt-1 text-xs ${MUTED}`}>Nội dung liên quan: {a.moves}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="d4-evidence" title="Bằng chứng trong hồ sơ" testId="d4-evidence">
        <p className={`text-xs ${MUTED}`}>{VISIBLE_ONLY_NOTE}</p>
        {evidence.length === 0 ? (
          <p className={`text-sm ${MUTED}`} data-testid="d4-evidence-empty">
            Chưa có bằng chứng nào hiển thị cho bạn.
          </p>
        ) : (
          <ul className="space-y-3">
            {evidence.map((e) => (
              <li key={e.id} className="rounded-lg border border-[var(--border-color)] p-3" data-testid="d4-evidence-item" data-mine={e.mine ? "true" : "false"}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold">{e.title}</p>
                  {e.badges.map((b) => (
                    <Pill key={b.label} tone={b.tone}>
                      {b.label}
                    </Pill>
                  ))}
                </div>
                <p className={`mt-1 text-xs ${MUTED}`}>{e.sourceLine}</p>
                {e.times.map((t) => (
                  <p key={t} className={`text-xs ${MUTED}`}>
                    {t}
                  </p>
                ))}
                {e.facts.length > 0 && (
                  <dl className="mt-2 space-y-1 text-sm">
                    {e.facts.map((f) => (
                      <div key={f.label}>
                        <dt className={`text-xs ${MUTED}`}>{f.label}</dt>
                        <dd className={`break-words ${f.label.startsWith("Mã") ? "font-mono text-xs [overflow-wrap:anywhere]" : "whitespace-pre-wrap"}`}>
                          {isReferenceValue(f.value) ? <CompactReference value={f.value} label={f.label} /> : f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {e.ownFile ? (
                  <PartyFileDownload caseId={caseId} evidenceId={e.id} fileName={e.ownFile.fileName} />
                ) : (
                  e.mine && e.facts.length > 0 && <p className={`mt-2 text-xs ${MUTED}`}>Không có tệp nào được lưu cho tài liệu này.</p>
                )}
                {e.caveat && (
                  <div className="mt-2">
                    <Notice tone="warning" testId="d4-evidence-caveat">
                      {e.caveat}
                    </Notice>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="d4-statements" title="Lời khai" testId="d4-statements">
        {statements.length === 0 ? (
          <p className={`text-sm ${MUTED}`} data-testid="d4-statements-empty">
            Chưa có lời khai nào trong hồ sơ.
          </p>
        ) : (
          <ol className="space-y-3">
            {statements.map((s) => (
              <li key={s.id} className="rounded-lg border border-[var(--border-color)] p-3" data-testid="d4-statement-item" data-mine={s.mine ? "true" : "false"}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{s.heading}</p>
                  <Pill tone={s.mine ? "info" : "neutral"}>{s.who}</Pill>
                </div>
                <p className={`mt-1 text-xs ${MUTED}`}>
                  {s.when}
                  {s.sourceLine ? ` · ${s.sourceLine}` : ""}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{s.text}</p>
                {s.supplementReason && (
                  <p className="mt-2 break-words text-sm">
                    <span className={`text-xs ${MUTED}`}>Lý do bổ sung: </span>
                    {s.supplementReason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel id="d4-money" title="Tiền" testId="d4-money">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={money.tone} testId="d4-money-label">
            {money.label}
          </Pill>
        </div>
        <p className="text-sm" data-testid="d4-money-note">
          {money.note}
        </p>
      </Panel>

      {partyAllowed(detail, "addStatement") && (
        <StatementForm
          caseId={caseId}
          nextVersion={nextVersion}
          onSaved={() => void onReload()}
          onReload={onReload}
          reloading={refreshing}
        />
      )}

      {partyAllowed(detail, "addEvidence") && (
        <DocumentForm
          caseId={caseId}
          onSaved={() => void onReload()}
          onReload={onReload}
          reloading={refreshing}
        />
      )}

      {partyAllowed(detail, "addEvidenceFile") && <PartyEvidenceFileForm caseId={caseId} onSaved={() => void onReload()} />}

      <PartyAgreementPanel
        caseId={caseId}
        detail={detail}
        agreements={detail.agreements}
        onChanged={onReload}
      />

      {partyAllowed(detail, "requestAppeal") ? (
        <PartyAppealForm
          caseId={caseId}
          onSaved={() => void onReload()}
          onReload={onReload}
          reloading={refreshing}
          closesAt={detail.appeal?.closesAt}
        />
      ) : (() => {
        const code = partyVerdictOf(detail, "requestAppeal")?.code;
        if (code === "APPEAL_WINDOW_CLOSED" || code === "APPEAL_ALREADY_REQUESTED" || code === "APPEAL_NOTICE_NOT_RECORDED") {
          const msg = partyRefusal(detail, "requestAppeal");
          if (msg) {
            return <p className={`text-sm ${MUTED}`}>{msg}</p>;
          }
        }
        return null;
      })()}
    </>
  );
}
