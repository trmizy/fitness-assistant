import { useQuery } from "@tanstack/react-query";
import { CaretRightIcon, TrayIcon } from "@phosphor-icons/react";
import { disputeCaseApi } from "../admin/disputes/disputeCaseApi";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../admin/disputes/disputeQueryKeys";
import { CARD, FOCUS, FailureBlock, LoadingBlock, MUTED, Pill, PartyLink, ReloadButton, casePath } from "./PartyParts";
import { NO_AUTO_REFRESH_NOTE } from "./partyLabels";
import { listRows } from "./partyModel";

/**
 * D4 / M12 - `/disputes`: the signed-in client's or PT's own cases (B1 `GET /dispute-cases`).
 * User-scoped query key (`useDisputeQueryKeys`): after an account switch the previous user's list can not be served. No polling:
 * every read writes an access-log row on the server, so "Tải lại" is always a click.
 */
export function MyDisputesPage() {
  const { keys } = useDisputeQueryKeys();
  const query = useQuery({
    queryKey: keys ? keys.partyList() : ["dispute-case", "disabled"],
    queryFn: () => disputeCaseApi.listMyCases(),
    enabled: !!keys,
    ...DISPUTE_QUERY_OPTIONS,
  });

  const rows = listRows(query.data?.items);
  const failure = query.isError ? parseDisputeError(query.error) : null;
  const refreshing = query.isFetching && !query.isLoading;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6" data-testid="d4-list-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--text-color)] sm:text-2xl">Khiếu nại của tôi</h1>
          <p className={`mt-1 text-sm ${MUTED}`}>
            Các hồ sơ khiếu nại buổi tập mà bạn là một bên. Mở một hồ sơ để xem trạng thái và gửi lời khai hoặc tài liệu của bạn.
          </p>
        </div>
        <ReloadButton onClick={() => void query.refetch()} busy={refreshing} />
      </header>
      <p className={`text-xs ${MUTED}`}>{NO_AUTO_REFRESH_NOTE}</p>

      {query.isLoading && <LoadingBlock testId="d4-list-loading" />}

      {failure && !query.data && (
        <FailureBlock
          testId="d4-list-failure"
          title="Chưa tải được danh sách khiếu nại"
          message={failure.message}
          onRetry={failure.kind === "auth" ? undefined : () => void query.refetch()}
          retrying={refreshing}
        />
      )}
      {failure && query.data && (
        <p role="alert" className="text-sm text-st-danger" data-testid="d4-list-refresh-failed">
          Chưa tải lại được: {failure.message} Danh sách bên dưới là lần tải trước.
        </p>
      )}

      {query.data && rows.length === 0 && (
        <div data-testid="d4-list-empty" className={`${CARD} flex flex-col items-center gap-2 border-dashed px-4 py-10 text-center`}>
          <TrayIcon className="size-8 text-[var(--muted-text-color)]" aria-hidden />
          <p className="font-semibold">Bạn chưa có hồ sơ khiếu nại nào</p>
          <p className={`max-w-sm text-sm ${MUTED}`}>Khi một buổi tập của bạn bị khiếu nại và được tiếp nhận thành hồ sơ, hồ sơ sẽ hiện ở đây.</p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-3" data-testid="d4-case-list" aria-label="Danh sách hồ sơ khiếu nại">
          {rows.map((r) => (
            <li key={r.id}>
              <PartyLink
                to={casePath(r.id)}
                data-testid="d4-case-row"
                className={`${CARD} flex min-h-11 items-center gap-3 p-4 transition-colors hover:bg-[var(--panel-bg)] ${FOCUS}`}
              >
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block break-words font-semibold">{r.title}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={r.tone}>{r.statusLabel}</Pill>
                  </span>
                  <span className={`block text-sm ${MUTED}`}>
                    Bạn là: <span className="text-[var(--text-color)]">{r.roleLabel}</span>
                    <span aria-hidden> · </span>
                    <span className="whitespace-nowrap">Mở ngày {r.createdLabel.split(" ")[0]}</span>
                  </span>
                </span>
                <CaretRightIcon className={`size-5 shrink-0 ${MUTED}`} aria-hidden />
              </PartyLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
