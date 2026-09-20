import { useQuery } from "@tanstack/react-query";
import {
  ClockIcon as Clock,
  CircleNotchIcon as Loader2,
  EnvelopeSimpleIcon as Mail,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react";
import {
  CATEGORY_LABEL,
  DOC_LABEL,
  partnerApplication,
  type ApplicationView,
  type DocType,
  type ReviewCategory,
  type TimelineEvent,
} from "../../services/partnerApplication";
import { Card, formatDateTime } from "./ui";

// Địa chỉ hỗ trợ do cấu hình build cung cấp; repo chưa có địa chỉ chính thức nên không tự đặt một cái.
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim();

function describe(e: TimelineEvent): string {
  const cat = e.category ? CATEGORY_LABEL[e.category as ReviewCategory] ?? e.category : null;
  const doc = e.docType ? DOC_LABEL[e.docType as DocType] ?? e.docType : null;
  switch (e.action) {
    case "APPLICATION_SUBMITTED":
      return "Bạn đã gửi hồ sơ";
    case "APPLICATION_RESUBMITTED":
      return "Bạn đã gửi lại hồ sơ sau khi chỉnh sửa";
    case "CHANGES_REQUESTED":
      return `Gymini đề nghị chỉnh sửa${e.count ? ` (${e.count} mục)` : ""}`;
    case "ISSUE_MARKED_UPDATED":
      return `Bạn đã đánh dấu đã cập nhật${cat ? `: ${cat}` : ""}`;
    case "ISSUE_RESOLVED":
      return `Gymini đã xác nhận đã xử lý${cat ? `: ${cat}` : ""}`;
    case "DOCUMENT_UPLOADED":
      return `Bạn đã tải lên ${doc ?? "giấy tờ"}`;
    case "DOCUMENT_REPLACED":
      return `Bạn đã thay ${doc ?? "giấy tờ"}`;
    case "DOCUMENT_ACCEPTED":
      return `${doc ?? "Giấy tờ"} đã được xác minh`;
    case "DOCUMENT_UPDATE_REQUESTED":
      return `${doc ?? "Giấy tờ"} cần được cập nhật`;
    case "APPLICATION_APPROVED":
      return "Hồ sơ đã được phê duyệt";
    case "APPLICATION_REJECTED":
      return "Hồ sơ chưa được chấp thuận";
    case "APPLICATION_REOPENED":
      return "Hồ sơ được mở lại để bạn chỉnh sửa";
    default:
      return "Cập nhật hồ sơ";
  }
}

/** Timeline dựng từ sự kiện ĐÃ LƯU ở server, không tự tính mốc thời gian ở frontend. */
export function ApplicationTimeline() {
  const q = useQuery({ queryKey: ["partner-application-timeline"], queryFn: partnerApplication.timeline, staleTime: 0, refetchOnMount: "always" });
  if (q.isLoading) return <Loader2 className="w-5 h-5 text-green-500 animate-spin" />;
  if (q.isError || !q.data) return <p className="text-xs text-zinc-500">Chưa tải được lịch sử hồ sơ.</p>;
  const events = q.data.events;
  return (
    <ol className="relative space-y-4 border-l border-zinc-800 pl-5">
      {q.data.accountCreatedAt && (
        <li className="relative">
          <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-zinc-600" />
          <p className="text-sm text-zinc-300">Tạo tài khoản đối tác</p>
          <p className="text-[11px] text-zinc-600">{formatDateTime(q.data.accountCreatedAt)}</p>
        </li>
      )}
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-green-500" />
          <p className="text-sm text-zinc-200">{describe(e)}</p>
          <p className="text-[11px] text-zinc-600">{formatDateTime(e.at)}</p>
        </li>
      ))}
    </ol>
  );
}

export function SubmittedView({ view }: { view: ApplicationView }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
          <Clock className="w-7 h-7 text-green-400" />
        </div>
        <h1 className="text-xl font-bold text-zinc-100">Hồ sơ đã được gửi</h1>
        <p className="text-sm text-zinc-400">
          Gymini đang xem xét hồ sơ của <span className="text-zinc-200 font-semibold">{view.brand?.name ?? "bạn"}</span>
          {view.partner.submittedAt ? ` (gửi lúc ${formatDateTime(view.partner.submittedAt)})` : ""}. Chúng tôi sẽ thông báo qua email khi có kết quả hoặc khi cần bạn bổ sung.
        </p>
        <p className="text-xs text-zinc-500">Trong thời gian chờ duyệt, bạn chưa thể dùng các tính năng quản lý phòng tập.</p>
      </Card>
      <Card>
        <h2 className="text-sm font-bold text-zinc-200 mb-4">Tiến trình hồ sơ</h2>
        <ApplicationTimeline />
      </Card>
    </div>
  );
}

export function RejectedView({ view }: { view: ApplicationView }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <XCircle className="w-9 h-9 text-red-400 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Hồ sơ chưa được chấp thuận</h1>
            {view.partner.rejectedAt && <p className="text-xs text-zinc-500">Ngày {formatDateTime(view.partner.rejectedAt)}</p>}
          </div>
        </div>
        {view.partner.rejectionReason && (
          <div>
            <p className="text-xs text-zinc-500">Lý do</p>
            <p className="text-sm text-zinc-200">{view.partner.rejectionReason}</p>
          </div>
        )}
        {view.partner.adminNote && (
          <div>
            <p className="text-xs text-zinc-500">Ghi chú từ Gymini</p>
            <p className="text-sm text-zinc-200">{view.partner.adminNote}</p>
          </div>
        )}
        <p className="text-sm text-zinc-400">Nếu cần trao đổi thêm hoặc cho rằng có nhầm lẫn, hãy liên hệ Gymini. Hồ sơ chỉ được mở lại để chỉnh sửa khi Gymini xác nhận.</p>
        {SUPPORT_EMAIL ? (
          <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:border-zinc-500">
            <Mail className="w-4 h-4" /> Liên hệ Gymini
          </a>
        ) : (
          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Hãy trả lời email thông báo kết quả từ Gymini để được hỗ trợ.
          </p>
        )}
      </Card>
      <Card>
        <h2 className="text-sm font-bold text-zinc-200 mb-4">Tiến trình hồ sơ</h2>
        <ApplicationTimeline />
      </Card>
    </div>
  );
}
