import { ArrowClockwiseIcon, ArrowUpRightIcon, CheckCircleIcon, ClockIcon, CpuIcon, FlagIcon, IdentificationCardIcon, LockKeyIcon, PulseIcon, ScalesIcon, UsersIcon, WarningIcon } from "@phosphor-icons/react";
import { AdminLink } from "../../components/layout/admin/AdminLink";
import { AttentionList } from "./shared/AttentionList";
import { RecentQueueList } from "./shared/RecentQueueList";
import { StatTile } from "./shared/StatTile";
import { ageMinutes, ageText, formatVnTime } from "./adminFinanceOverview.utils";
import { CompactStat } from "./today/CompactStat";
import { ROUTES } from "./today/todayModel";
import {
  BALANCE_SCOPE_TEXT,
  RECENT_SOURCE_NOTE,
  RECENT_TITLE,
  balanceTile,
  buildAttentionItems,
  buildRecent,
  disputesStat,
  moneyActionTile,
  pendingWithdrawalTile,
  reviewTile,
  servicesStat,
  usersNewStat,
  usersTotalStat,
} from "./today/todayView";
import { useTodayData } from "./today/useTodayData";

/**
 * "Hôm nay" (`/admin/dashboard`, B3b). Action-first: what needs a decision today, money first, then how the books stand.
 *
 *  1. four tiles — Cần xử lý về tiền · Rút tiền chờ duyệt · Hồ sơ chờ duyệt · Cân đối sổ ví (ESCROW = Σ quyền đòi)
 *  2. four compact stats — người dùng · mới 7 ngày · dịch vụ đang chạy · tranh chấp đang mở
 *  3. panels — "Việc cần xử lý" (each row links to its queue) | "Mục mới tạo gần nhất trong các hàng đợi" (not an activity feed)
 *
 * Every number comes from its own query (`today/useTodayData.ts`); a source that is loading or failed shows "—" and says why,
 * the others still render — nothing is ever shown as 0 because it is unknown. The old charts / OCR block / "Đăng ký gần
 * đây" table / membership-refund card moved or were dropped on purpose: see docs/admin-redesign/review/b3b/CHECKS.md.
 */

const BTN =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] disabled:opacity-60 motion-reduce:transition-none lg:min-h-9";
const LINK = "font-semibold text-adm-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

export function AdminDashboard() {
  const d = useTodayData();
  const { nowMs } = d;

  if (d.allForbidden) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div data-testid="today-forbidden" role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-adm-border bg-adm-surface px-4 py-12 text-center shadow-adm-card">
          <LockKeyIcon className="size-8 text-adm-text-2" aria-hidden />
          <h1 className="text-lg font-bold text-adm-text">Không có quyền xem trang Hôm nay</h1>
          <p className="max-w-md text-sm text-adm-text-2">Tài khoản này không có quyền xem dữ liệu quản trị, hoặc phiên đăng nhập đã hết hạn. Hãy đăng nhập lại bằng tài khoản quản trị.</p>
        </div>
      </div>
    );
  }

  const money = moneyActionTile(d);
  const pending = pendingWithdrawalTile(d);
  const review = reviewTile(d);
  const bal = balanceTile(d);
  const recent = buildRecent(d, nowMs);
  const dimmed = d.stale.stale;

  const BalanceIcon = bal.balanced === false ? WarningIcon : bal.balanced ? CheckCircleIcon : ScalesIcon;
  const balanceNote =
    bal.status === "ready" ? (
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-testid="today-balance-chip"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
              bal.balanced ? "border-st-success-border bg-st-success-bg text-st-success" : "border-st-danger-border bg-st-danger-bg text-st-danger"
            }`}
          >
            {bal.balanced ? <CheckCircleIcon className="size-3.5" aria-hidden /> : <WarningIcon className="size-3.5" aria-hidden />}
            {bal.balanced ? "Cân bằng" : "Lệch sổ"}
          </span>
          {bal.direction && <span>{bal.direction}</span>}
        </span>
        {bal.conflict && <span>Máy chủ báo lệch bằng mã 409 kèm số liệu — đây là cảnh báo về sổ, không phải lỗi tải.</span>}
        <span data-testid="today-balance-scope">{BALANCE_SCOPE_TEXT}</span>
        <span>
          Tính đến {formatVnTime(d.balanceUpdatedAt)} ·{" "}
          <AdminLink to={ROUTES.balance} data-testid="today-balance-link" className={LINK}>
            Xem đối soát
          </AdminLink>
        </span>
      </span>
    ) : undefined;

  return (
    <div data-testid="admin-today" className="mx-auto flex max-w-7xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 data-testid="today-title" className="text-2xl font-bold text-adm-text sm:text-[28px]">
            Hôm nay
          </h1>
          <p className="mt-0.5 text-sm text-adm-text-2">Những việc cần xử lý và tình trạng sổ sách tính đến lúc này.</p>
        </div>
        <div className="flex items-center gap-3">
          <span data-testid="today-updated" className="text-xs tabular-nums text-adm-text-2">
            {d.updatedAt ? `Cập nhật lúc ${formatVnTime(d.updatedAt)}` : ""}
          </span>
          <button type="button" onClick={d.refresh} aria-busy={d.fetching} data-testid="today-refresh" className={BTN}>
            <ArrowClockwiseIcon className={`size-3.5 ${d.fetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Làm mới
          </button>
        </div>
      </div>

      {d.stale.stale && (
        <div
          role="status"
          data-testid="today-stale"
          className="inline-flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-st-pending-border bg-st-pending-bg px-2.5 py-1.5 text-xs font-medium text-st-pending"
        >
          <ClockIcon className="size-4 shrink-0" aria-hidden />
          <span>
            Dữ liệu lúc {formatVnTime(d.stale.updatedAt)} — đã cũ {ageText(ageMinutes(d.stale.updatedAt, nowMs))}
            {d.stale.reason === "REFETCH_FAILED" ? " (lần cập nhật gần nhất không thành công)" : ""}. Bấm “Làm mới” để đọc lại.
          </span>
        </div>
      )}

      <section aria-label="Việc cần quyết định" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile testId="today-tile-money" label="Cần xử lý về tiền" icon={WarningIcon} tone="warning" status={money.status} value={money.value} note={money.note} errorText={money.errorText} dimmed={dimmed} />
        <StatTile testId="today-tile-withdrawals" label="Rút tiền chờ duyệt" icon={ArrowUpRightIcon} tone="info" status={pending.status} value={pending.value} note={pending.note} errorText={pending.errorText} dimmed={dimmed} />
        <StatTile testId="today-tile-review" label="Hồ sơ chờ duyệt" icon={IdentificationCardIcon} tone="neutral" status={review.status} value={review.value} note={review.note} errorText={review.errorText} dimmed={dimmed} />
        <StatTile
          testId="today-tile-balance"
          label="Cân đối sổ ví (ESCROW = Σ quyền đòi)"
          icon={BalanceIcon}
          tone={bal.balanced === false ? "danger" : bal.balanced ? "success" : "neutral"}
          danger={bal.balanced === false}
          status={bal.status}
          value={bal.value}
          note={balanceNote}
          errorText={bal.errorText}
          dimmed={dimmed}
        />
      </section>

      <section aria-label="Chỉ số nền tảng" className="order-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:order-none xl:grid-cols-4">
        <CompactStat testId="today-stat-users" label="Người dùng" icon={UsersIcon} tone="neutral" dimmed={dimmed} {...usersTotalStat(d)} />
        <CompactStat testId="today-stat-new" label="Mới 7 ngày" icon={PulseIcon} tone="info" dimmed={dimmed} {...usersNewStat(d)} />
        <CompactStat testId="today-stat-services" label="Dịch vụ đang chạy" icon={CpuIcon} tone="success" dimmed={dimmed} {...servicesStat(d)} />
        <CompactStat testId="today-stat-disputes" label="Tranh chấp đang mở" icon={FlagIcon} tone="warning" dimmed={dimmed} {...disputesStat(d)} />
      </section>

      <div className="order-2 grid grid-cols-1 items-start gap-5 lg:order-none lg:grid-cols-2">
        <div className="space-y-2">
          <AttentionList testId="today-attention" headingId="today-attention-h" title="Việc cần xử lý" description="Sắp theo độ khẩn · mục tiền đứng trước" items={buildAttentionItems(d, nowMs)} />
          <p className="px-1 text-xs text-adm-text-2">
            Hoàn tiền gói hội viên (ngoại lệ) không có hàng đợi — nhập mã tại{" "}
            <AdminLink to={ROUTES.membershipRefund} data-testid="today-membership-refund-link" className={LINK}>
              Tài chính › Hoàn tiền › Gói hội viên
            </AdminLink>
            .
          </p>
        </div>
        <RecentQueueList
          testId="today-recent"
          headingId="today-recent-h"
          title={RECENT_TITLE}
          description="Mỗi hàng đợi một mục mới nhất · không phải toàn bộ hoạt động"
          items={recent.items}
          loadingCount={recent.loading}
          failedQueues={recent.failed}
          allEmpty={recent.allEmpty}
          sourceNote={RECENT_SOURCE_NOTE}
        />
      </div>
    </div>
  );
}
