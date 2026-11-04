import type { ReactNode } from "react";
import { ArrowClockwiseIcon, ArrowLeftIcon, LockKeyIcon, WarningCircleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Button } from "../../../components/ui/button";
import { CARD, DisputeLink, EmptyBox, FOCUS, FieldList, LoadingSkeleton, Muted, Notice, Pill, Section } from "../disputes/workspace/WorkspaceParts";
import type { GymErrorView } from "./gymCaseErrors";
import { GYM_CASE_DISABLED_NOTE } from "./gymCaseLabels";
import { COMPLAINTS_PATH } from "./gymCaseModel";

export { CARD, DisputeLink, EmptyBox, FOCUS, FieldList, LoadingSkeleton, Muted, Notice, Pill, Section };

export const CASES_QUEUE_PATH = `${COMPLAINTS_PATH}?view=cases`;

export interface GymFailure {
  kind: "notFound" | "forbidden" | "auth" | "conflict" | "network" | "other";
  title: string;
  body: string;
  canReload: boolean;
  backToQueue: boolean;
}

/** A failed LOAD of the case. Never drawn as an empty case. */
export function describeGymLoadFailure(view: GymErrorView): GymFailure {
  switch (view.kind) {
    case "notFound":
      return { kind: "notFound", title: "Không tìm thấy hồ sơ", body: "Hồ sơ không tồn tại hoặc bạn không có quyền xem. Quay lại danh sách để chọn lại.", canReload: false, backToQueue: true };
    case "forbidden":
      return { kind: "forbidden", title: "Bạn không có quyền xem hồ sơ này", body: "Chỉ quản trị viên xem được hồ sơ xử lý khiếu nại phòng gym.", canReload: false, backToQueue: true };
    case "auth":
      return { kind: "auth", title: "Phiên đăng nhập đã hết hạn", body: "Hãy đăng nhập lại để tiếp tục.", canReload: false, backToQueue: false };
    case "conflictReload":
      return { kind: "conflict", title: "Hồ sơ vừa được cập nhật", body: "Hãy tải lại để thấy bản mới nhất. Đây không phải hồ sơ trống.", canReload: true, backToQueue: false };
    case "network":
      return { kind: "network", title: "Không kết nối được máy chủ", body: "Kiểm tra mạng rồi thử lại. Đây không phải hồ sơ trống.", canReload: true, backToQueue: false };
    default:
      return { kind: "other", title: "Chưa tải được hồ sơ", body: `${view.message} Đây không phải hồ sơ trống.`, canReload: true, backToQueue: true };
  }
}

export function GymFailurePanel({ failure, onReload, reloading, testId = "d6-failure" }: { failure: GymFailure; onReload?: () => void; reloading?: boolean; testId?: string }) {
  const Icon = failure.kind === "forbidden" || failure.kind === "auth" ? LockKeyIcon : failure.kind === "network" ? WifiSlashIcon : WarningCircleIcon;
  return (
    <div role="alert" data-testid={testId} data-failure={failure.kind} className="flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 py-10 text-center">
      <Icon className="size-8 text-st-danger" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-st-danger">{failure.title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">{failure.body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {failure.canReload && onReload && (
          <Button type="button" variant="outline" size="sm" onClick={onReload} disabled={reloading} className="min-h-11 xl:min-h-8" data-testid={`${testId}-reload`}>
            <ArrowClockwiseIcon aria-hidden /> {failure.kind === "conflict" ? "Tải lại hồ sơ" : "Thử lại"}
          </Button>
        )}
        {failure.backToQueue && (
          <DisputeLink
            to={CASES_QUEUE_PATH}
            data-testid={`${testId}-back`}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-8 ${FOCUS}`}
          >
            <ArrowLeftIcon className="size-4" aria-hidden /> Về danh sách hồ sơ
          </DisputeLink>
        )}
      </div>
    </div>
  );
}

/** Shown once, at the top, when the server refuses every write because the layer is off. */
export function WriteOffNote() {
  return (
    <Notice tone="info" testId="d6-write-off" role="note">
      {GYM_CASE_DISABLED_NOTE}
    </Notice>
  );
}

/** A row of label/value pairs on small screens (one column) and two columns from `sm`. */
export function Facts({ items, testId }: { items: Array<{ label: string; value: ReactNode }>; testId?: string }) {
  return (
    <dl data-testid={testId} className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((f, i) => (
        <div key={`${f.label}-${i}`} className="min-w-0">
          <dt className="text-xs text-adm-text-2">{f.label}</dt>
          <dd className="break-words font-medium text-adm-text">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
