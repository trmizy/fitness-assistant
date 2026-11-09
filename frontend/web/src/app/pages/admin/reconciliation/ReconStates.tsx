import { useEffect, useState } from "react";
import { ClockIcon, LockKeyIcon } from "@phosphor-icons/react";
import { ageText, formatVnTime, type Staleness } from "../adminFinanceOverview.utils";
import { FOCUS, LevelBadge } from "./ExceptionParts";
import type { ReconLevel } from "./reconciliationView";

/** Shared "state" pieces of both Đối soát chips: level note, stale chip, 403 panel. */

export const BALANCE_MAX_AGE_MS = 3 * 60_000;
export const EXCEPTIONS_MAX_AGE_MS = 3 * 60_000;

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** One line under the chips: which level this screen is, and what that level does (not) verify. */
export function LevelNote({ level, text, testId }: { level: ReconLevel; text: string; testId: string }) {
  return (
    <div data-testid={testId} className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5 rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2.5 text-xs text-adm-text">
      <LevelBadge level={level} source={level === "L1" ? "số nội bộ" : "callback"} />
      <span className="min-w-0 flex-1 basis-60 leading-relaxed">{text}</span>
    </div>
  );
}

export function StaleChip({ info, nowMs, onRefresh, busy, testId }: { info: Staleness; nowMs: number; onRefresh: () => void; busy: boolean; testId: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-st-pending-border bg-st-pending-bg px-2.5 py-1.5 text-xs font-medium text-st-pending"
    >
      <ClockIcon className="size-4 shrink-0" aria-hidden />
      <span>
        Dữ liệu lúc {formatVnTime(info.updatedAt)} — đã cũ {ageText(Math.floor((nowMs - info.updatedAt) / 60_000))}
        {info.reason === "REFETCH_FAILED" ? " (lần cập nhật gần nhất không thành công)" : ""}
      </span>
      <button type="button" onClick={onRefresh} disabled={busy} className={`min-h-11 font-bold underline underline-offset-2 lg:min-h-0 ${FOCUS}`}>
        Làm mới
      </button>
    </div>
  );
}

export function ForbiddenPanel() {
  return (
    <div
      data-testid="recon-forbidden"
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-adm-border bg-adm-surface px-4 py-12 text-center shadow-adm-card"
    >
      <LockKeyIcon className="size-8 text-adm-text-2" aria-hidden />
      <h2 className="text-lg font-bold text-adm-text">Không có quyền xem dữ liệu đối soát</h2>
      <p className="max-w-md text-sm text-adm-text-2">Tài khoản này không có quyền xem dữ liệu tài chính, hoặc phiên đăng nhập đã hết hạn. Hãy đăng nhập lại bằng tài khoản quản trị.</p>
    </div>
  );
}
