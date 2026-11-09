import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CaretRightIcon } from "@phosphor-icons/react";
import { gymCaseApi } from "../admin/complaints/gymCaseApi";
import { parseGymError } from "../admin/complaints/gymCaseErrors";
import { issueLabel } from "../admin/complaints/gymCaseLabels";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "../admin/complaints/gymCaseQueryKeys";
import { parseGymCaseId } from "../admin/complaints/gymCaseModel";
import { formatMoneyExact } from "../admin/adminFinanceOverview.utils";
/** INT-22: server sentences carry raw decimals ("200000.00"); swap exactly those strings for grouped VND, nothing else. */
const withMoney = (text: string | null | undefined, m: { postedToWallet?: string | number | null; stillOwed?: string | number | null } | null | undefined): string => {
  let out = text ?? "";
  for (const raw of [m?.postedToWallet, m?.stillOwed]) if (raw !== null && raw !== undefined && String(raw) !== "") out = out.split(String(raw)).join(formatMoneyExact(raw));
  return out;
};
import { CARD, FOCUS, FailureBlock, LoadingBlock, MUTED, PartyLink, ReloadButton } from "../disputes/PartyParts";
import { GymStatementForm, GymDocumentForm, GymMemberAppealForm } from "./GymMemberForms";

const ROOT = "/complaint-cases";
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString("vi-VN") : "Chưa rõ";

/** G20: only the member-safe fields returned by /me/complaint-cases are rendered. */
export function MyGymComplaintCasesPage() {
  const { keys } = useGymQueryKeys();
  const query = useQuery({
    queryKey: keys ? keys.myList() : ["gym-complaint", "disabled", "my-list"],
    queryFn: gymCaseApi.listMine,
    enabled: !!keys,
    ...GYM_QUERY_OPTIONS,
  });
  const failure = query.isError ? parseGymError(query.error) : null;
  return <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="d6-member-list">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold text-[var(--text-color)]">Khiếu nại phòng gym của tôi</h1><p className={`mt-1 text-sm ${MUTED}`}>Theo dõi hồ sơ bạn đã phản ánh với phòng gym.</p></div>
      <ReloadButton onClick={() => void query.refetch()} busy={query.isFetching} />
    </header>
    {query.isLoading && <LoadingBlock testId="d6-member-list-loading" />}
    {failure && !query.data && <FailureBlock title="Chưa tải được hồ sơ" message={failure.message} onRetry={() => void query.refetch()} retrying={query.isFetching} testId="d6-member-list-error" />}
    {failure && query.data && <p role="alert" className="text-sm text-[var(--text-color)]">Chưa tải lại được. Danh sách bên dưới là lần tải trước.</p>}
    {query.data?.items.length === 0 && <div className={`${CARD} p-6 text-center text-sm ${MUTED}`}>Bạn chưa có hồ sơ khiếu nại phòng gym nào.</div>}
    <ul className="space-y-3">{query.data?.items.map((item) => <li key={item.id}>
      <PartyLink to={`${ROOT}/${encodeURIComponent(item.id)}`} className={`${CARD} flex min-h-11 items-center gap-3 p-4 ${FOCUS}`} data-testid="d6-member-case-row">
        <span className="min-w-0 flex-1"><span className="block font-semibold text-[var(--text-color)]">{item.progress}</span><span className={`block text-sm ${MUTED}`}>Mở lúc {date(item.createdAt)}</span></span>
        <CaretRightIcon className="size-5" aria-hidden />
      </PartyLink>
    </li>)}</ul>
  </div>;
}

/** G21: this page deliberately renders no admin status, class, outcome or private record payload. */
export function MyGymComplaintCasePage() {
  const { caseId: raw } = useParams();
  const caseId = parseGymCaseId(raw);
  const { keys } = useGymQueryKeys();
  const query = useQuery({
    queryKey: keys && caseId ? keys.myDetail(caseId) : ["gym-complaint", "disabled", "my-detail"],
    queryFn: () => gymCaseApi.getMine(caseId as string),
    enabled: !!keys && !!caseId,
    ...GYM_QUERY_OPTIONS,
  });
  const failure = query.isError ? parseGymError(query.error) : null;
  const d = query.data;
  return <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="d6-member-detail">
    <PartyLink to={ROOT} className={`inline-flex min-h-11 items-center text-sm text-[var(--text-color)] ${FOCUS}`}>← Danh sách khiếu nại phòng gym</PartyLink>
    {query.isLoading && <LoadingBlock testId="d6-member-detail-loading" />}
    {!caseId && <div role="alert" className={`${CARD} p-4 text-sm`}>Đường dẫn hồ sơ không hợp lệ.</div>}
    {failure && !d && <FailureBlock title="Chưa tải được hồ sơ" message={failure.message} onRetry={failure.kind === "auth" ? undefined : () => void query.refetch()} retrying={query.isFetching} testId="d6-member-detail-error" />}
    {d && <>
      <header className={`${CARD} space-y-2 p-4`}><h1 className="text-xl font-bold text-[var(--text-color)]">Hồ sơ khiếu nại phòng gym</h1><p className="text-sm font-medium text-[var(--text-color)]">{d.case.progress}</p><p className={`text-xs ${MUTED}`}>Mở lúc {date(d.case.createdAt)}</p></header>
      <section className={`${CARD} space-y-2 p-4`}><h2 className="font-semibold text-[var(--text-color)]">Nội dung phản ánh</h2><p className={`text-sm ${MUTED}`}>{issueLabel(d.complaint.issueType)}</p><p className="whitespace-pre-wrap break-words text-sm text-[var(--text-color)]">{d.complaint.description}</p></section>
      <section className={`${CARD} space-y-2 p-4`}><h2 className="font-semibold text-[var(--text-color)]">Bằng chứng bạn được xem</h2><p className={`text-xs ${MUTED}`}>Mã băm của tài liệu chỉ là thông tin người nộp khai báo, chưa chứng minh tệp đã được xác minh.</p>
        {d.evidence.length === 0 ? <p className={`text-sm ${MUTED}`}>Chưa có mục nào được chia sẻ.</p> : <ul className="space-y-2">{d.evidence.map((e) => <li key={e.id} className="rounded-lg border border-[var(--border-color)] p-3 text-sm text-[var(--text-color)]">{e.mine ? "Bằng chứng của bạn" : "Thông tin được chia sẻ"} · {date(e.capturedAt)}</li>)}</ul>}
      </section>
      <section className={`${CARD} space-y-2 p-4`}><h2 className="font-semibold text-[var(--text-color)]">Lời khai</h2>{d.statements.length === 0 ? <p className={`text-sm ${MUTED}`}>Chưa có lời khai.</p> : <ul className="space-y-2">{d.statements.map((s) => <li key={s.id} className="rounded-lg border border-[var(--border-color)] p-3 text-sm"><p className={`text-xs ${MUTED}`}>{s.mine ? "Bạn đã gửi" : "Lời khai được chia sẻ"} · {date(s.createdAt)}</p><p className="mt-1 whitespace-pre-wrap break-words text-[var(--text-color)]">{s.text}</p></li>)}</ul>}</section>
      {d.money && <section className={`${CARD} space-y-2 p-4`}><h2 className="font-semibold text-[var(--text-color)]">Tiền</h2><p className="text-sm text-[var(--text-color)]">{withMoney(d.money.label, d.money)}</p>{d.money.postedToWallet && <p className="text-sm text-[var(--text-color)]">Đã ghi vào ví Gymini: {formatMoneyExact(d.money.postedToWallet)}</p>}{d.money.stillOwed && <p className="text-sm text-[var(--text-color)]">Còn thiếu (chưa trả): {formatMoneyExact(d.money.stillOwed)}</p>}</section>}
      {d.resolution?.text && <section className={`${CARD} space-y-2 p-4`}><h2 className="font-semibold text-[var(--text-color)]">Kết quả xử lý</h2><p className="whitespace-pre-wrap break-words text-sm text-[var(--text-color)]">{withMoney(d.resolution.text, d.money)}</p></section>}
      {d.case.canSubmit ? (
        <>
          <GymStatementForm
            caseId={d.case.id}
            statementCount={d.statements.length}
            onSaved={() => void query.refetch()}
          />
          <GymDocumentForm
            caseId={d.case.id}
            onSaved={() => void query.refetch()}
          />
        </>
      ) : (
        <p className={`text-sm ${MUTED}`}>
          Hồ sơ hiện không nhận thêm lời khai hay tài liệu.
        </p>
      )}

      {d.appeal?.canFile && (
        <GymMemberAppealForm
          caseId={d.case.id}
          onSaved={() => void query.refetch()}
          closesAt={d.appeal?.closesAt}
        />
      )}
    </>}
  </div>;
}
