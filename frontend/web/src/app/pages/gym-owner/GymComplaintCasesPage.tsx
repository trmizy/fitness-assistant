import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CaretRightIcon } from "@phosphor-icons/react";
import { gymCaseApi } from "../admin/complaints/gymCaseApi";
import { parseGymError } from "../admin/complaints/gymCaseErrors";
import { issueLabel } from "../admin/complaints/gymCaseLabels";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "../admin/complaints/gymCaseQueryKeys";
import { describeEvidence, parseGymCaseId } from "../admin/complaints/gymCaseModel";
import type { GymEvidence } from "../admin/complaints/gymCaseTypes";
import { gymService } from "../../services/api";
import type { Gym } from "../../types";
import { CARD, FOCUS, FailureBlock, LoadingBlock, MUTED, Notice, PartyLink, Pill, ReloadButton } from "../disputes/PartyParts";
import { GymStatementForm, GymDocumentForm } from "../complaints/GymMemberForms";

const ROOT = "/gym-owner/complaint-cases";
const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("vi-VN") : "Chưa rõ");

/** Tên chi nhánh để chủ nhiều chi nhánh biết hồ sơ thuộc nơi nào. Cùng query key với các trang chủ gym khác nên thường chỉ là đọc cache. */
function useGymNames(): (gymId: string) => string | null {
  const { data: gyms = [] } = useQuery<Gym[]>({ queryKey: ["owned-gyms"], queryFn: () => gymService.listOwnedGyms() });
  const names = new Map(gyms.map((g) => [g.id, g.name]));
  return (gymId) => names.get(gymId) ?? null;
}

/** The response clock is shown as a date, plus a plain "đã quá hạn" when it has passed (the server keeps the case open either way). */
function RespondBy({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const overdue = new Date(value).getTime() < Date.now();
  return <Pill tone={overdue ? "danger" : "warning"}>{overdue ? `Đã quá hạn phản hồi (${date(value)})` : `Hạn phản hồi: ${date(value)}`}</Pill>;
}

/** ND-07: the gym owner's (or branch manager's) list of complaint cases about their branches. The server returns only what the Gym may see. */
export function GymComplaintCasesPage() {
  const { keys } = useGymQueryKeys();
  const gymName = useGymNames();
  const query = useQuery({
    queryKey: keys ? keys.ownerList() : ["gym-complaint", "disabled", "owner-list"],
    queryFn: gymCaseApi.listOwner,
    enabled: !!keys,
    ...GYM_QUERY_OPTIONS,
  });
  const failure = query.isError ? parseGymError(query.error) : null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="owner-case-list">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--text-color)]">Khiếu nại về phòng gym</h1>
          <p className={`mt-1 text-sm ${MUTED}`}>Hồ sơ khiếu nại của hội viên về các chi nhánh của bạn. Bạn có thể giải trình và gửi bằng chứng.</p>
        </div>
        <ReloadButton onClick={() => void query.refetch()} busy={query.isFetching} />
      </header>
      {query.isLoading && <LoadingBlock testId="owner-case-list-loading" />}
      {failure && !query.data && <FailureBlock title="Chưa tải được hồ sơ" message={failure.message} onRetry={failure.kind === "auth" ? undefined : () => void query.refetch()} retrying={query.isFetching} testId="owner-case-list-error" />}
      {failure && query.data && <p role="alert" className="text-sm text-[var(--text-color)]">Chưa tải lại được. Danh sách bên dưới là lần tải trước.</p>}
      {query.data?.items.length === 0 && <div className={`${CARD} p-6 text-center text-sm ${MUTED}`}>Hiện chưa có hồ sơ khiếu nại nào về phòng gym của bạn.</div>}
      <ul className="space-y-3">
        {query.data?.items.map((item) => (
          <li key={item.id}>
            <PartyLink to={`${ROOT}/${encodeURIComponent(item.id)}`} className={`${CARD} flex min-h-11 items-center gap-3 p-4 ${FOCUS}`} data-testid="owner-case-row">
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block break-words font-semibold text-[var(--text-color)]">{issueLabel(item.issueType)}</span>
                {gymName(item.gymId) && <span className={`block break-words text-sm ${MUTED}`}>{gymName(item.gymId)}</span>}
                <span className={`block text-sm ${MUTED}`}>{item.progress} · mở lúc {date(item.createdAt)}</span>
                {item.canSubmit && <span className="flex flex-wrap gap-1.5 pt-0.5"><Pill tone="info">Đang chờ phòng gym phản hồi</Pill><RespondBy value={item.respondBy} /></span>}
              </span>
              <CaretRightIcon className="size-5 shrink-0" aria-hidden />
            </PartyLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** ND-07: one case. Never shows who the member is, findings, money or the investigation: the server does not send them. */
export function GymComplaintCasePage() {
  const { caseId: raw } = useParams();
  const caseId = parseGymCaseId(raw);
  const { keys } = useGymQueryKeys();
  const gymName = useGymNames();
  const query = useQuery({
    queryKey: keys && caseId ? keys.ownerDetail(caseId) : ["gym-complaint", "disabled", "owner-detail"],
    queryFn: () => gymCaseApi.getOwner(caseId as string),
    enabled: !!keys && !!caseId,
    ...GYM_QUERY_OPTIONS,
  });
  const failure = query.isError ? parseGymError(query.error) : null;
  const d = query.data;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="owner-case-detail">
      <PartyLink to={ROOT} className={`inline-flex min-h-11 items-center text-sm text-[var(--text-color)] ${FOCUS}`}>← Danh sách khiếu nại về phòng gym</PartyLink>
      {query.isLoading && <LoadingBlock testId="owner-case-detail-loading" />}
      {!caseId && <div role="alert" className={`${CARD} p-4 text-sm`}>Đường dẫn hồ sơ không hợp lệ.</div>}
      {failure && !d && <FailureBlock title="Chưa tải được hồ sơ" message={failure.message} onRetry={failure.kind === "auth" ? undefined : () => void query.refetch()} retrying={query.isFetching} testId="owner-case-detail-error" />}
      {d && (
        <>
          <header className={`${CARD} space-y-2 p-4`}>
            <h1 className="text-xl font-bold text-[var(--text-color)]">Hồ sơ khiếu nại về phòng gym</h1>
            {gymName(d.case.gymId) && <p className="break-words text-sm text-[var(--text-color)]">{gymName(d.case.gymId)}</p>}
            <p className="text-sm font-medium text-[var(--text-color)]">{d.case.progress}</p>
            <p className={`text-xs ${MUTED}`}>Mở lúc {date(d.case.createdAt)}</p>
            {d.case.canSubmit && <div className="flex flex-wrap gap-1.5"><RespondBy value={d.case.respondBy} /></div>}
          </header>
          <section className={`${CARD} space-y-2 p-4`}>
            <h2 className="font-semibold text-[var(--text-color)]">Nội dung phản ánh</h2>
            <p className={`text-sm ${MUTED}`}>{issueLabel(d.complaint.issueType)}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-[var(--text-color)]">{d.complaint.description}</p>
          </section>
          <section className={`${CARD} space-y-2 p-4`}>
            <h2 className="font-semibold text-[var(--text-color)]">Bằng chứng bạn được xem</h2>
            <p className={`text-xs ${MUTED}`}>Danh tính hội viên được giữ kín. Mã sha256 của tài liệu chỉ là thông tin người nộp tự khai, chưa được kiểm chứng.</p>
            {d.evidence.length === 0 ? (
              <p className={`text-sm ${MUTED}`}>Chưa có mục nào.</p>
            ) : (
              <ul className="space-y-2">
                {d.evidence.map((e) => {
                  const view = describeEvidence({ ...e, snapshotVersion: 0 } as unknown as GymEvidence);
                  return (
                    <li key={e.id} className="space-y-1 rounded-lg border border-[var(--border-color)] p-3 text-sm text-[var(--text-color)]" data-testid="owner-case-evidence">
                      <p className="font-medium">{e.mine ? "Bằng chứng của phòng gym" : view.title}</p>
                      <p className={`text-xs ${MUTED}`}>{date(e.capturedAt)}</p>
                      {view.fields.map((f) => (
                        <p key={f.label} className="break-words"><span className={MUTED}>{f.label}: </span>{f.value}</p>
                      ))}
                      {view.notes.map((n) => <p key={n} className={`text-xs ${MUTED}`}>{n}</p>)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className={`${CARD} space-y-2 p-4`}>
            <h2 className="font-semibold text-[var(--text-color)]">Giải trình</h2>
            {d.statements.length === 0 ? (
              <p className={`text-sm ${MUTED}`}>Chưa có lời giải trình.</p>
            ) : (
              <ul className="space-y-2">
                {d.statements.map((s) => (
                  <li key={s.id} className="rounded-lg border border-[var(--border-color)] p-3 text-sm">
                    <p className={`text-xs ${MUTED}`}>{s.mine ? "Phòng gym đã gửi" : "Nội dung được chia sẻ"} · {date(s.createdAt)}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[var(--text-color)]">{s.text}</p>
                    {s.supplementReason && <p className={`mt-1 text-xs ${MUTED}`}>Lý do bổ sung: {s.supplementReason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {d.case.canSubmit ? (
            <>
              <GymStatementForm caseId={d.case.id} party="gym" statementCount={d.statements.filter((s) => s.mine).length} submit={gymCaseApi.submitOwnerExplanation} onSaved={() => void query.refetch()} />
              <GymDocumentForm caseId={d.case.id} submit={gymCaseApi.submitOwnerEvidence} onSaved={() => void query.refetch()} />
            </>
          ) : (
            <Notice tone="info">Hồ sơ hiện không nhận thêm giải trình hay tài liệu.</Notice>
          )}
        </>
      )}
    </div>
  );
}
