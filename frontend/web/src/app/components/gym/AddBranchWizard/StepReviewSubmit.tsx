import { useQuery } from "@tanstack/react-query";
import { CircleNotchIcon, CheckCircleIcon, WarningCircleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { gymService, gymPhotoUrl } from "../../../services/api";
import type { GymOperatingHoursDay, GymPhoto, GymBranchDocument, BranchReviewCategory } from "../../../types";
import type { BasicInfoValue } from "./StepBasicInfo";
import type { LocationValue } from "./StepLocation";
import { FACILITY_LABEL } from "./StepFacilities";

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Thứ 2", TUESDAY: "Thứ 3", WEDNESDAY: "Thứ 4", THURSDAY: "Thứ 5", FRIDAY: "Thứ 6", SATURDAY: "Thứ 7", SUNDAY: "Chủ nhật",
};
function minutesToTime(m: number | null): string {
  if (m == null) return "";
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}
function hoursSummaryLine(day: GymOperatingHoursDay): string {
  if (day.type === "CLOSED") return "Đóng cửa";
  if (day.type === "ALL_DAY") return "Mở 24 giờ";
  return `${minutesToTime(day.openMinute)} - ${minutesToTime(day.closeMinute)}`;
}

const CATEGORY_LABEL: Record<BranchReviewCategory, string> = {
  BASIC_INFO: "Thông tin cơ bản", LOCATION: "Địa điểm", OPENING_HOURS: "Giờ hoạt động",
  FACILITIES: "Tiện ích & Dịch vụ", PHOTOS: "Hình ảnh", VERIFICATION: "Xác minh", OTHER: "Khác",
};
const CATEGORY_STEP: Record<BranchReviewCategory, number | null> = {
  BASIC_INFO: 1, LOCATION: 2, OPENING_HOURS: 3, FACILITIES: 4, PHOTOS: 5, VERIFICATION: 6, OTHER: null,
};
const FIELD_STEP: Record<string, number> = {
  name: 1, description: 1, phone: 1, email: 1,
  address: 2, city: 2, provinceCode: 2, wardCode: 2, latitude: 2, longitude: 2, locationNote: 2,
  operatingHours: 3, facilities: 4, verification: 6,
};

export interface SubmitIssue {
  field: string;
  message: string;
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 4 — Step 7 "Review & Submit". Summarizes steps 1-6
 * (fetching its own photos/branch-documents counts, same self-contained pattern as
 * StepPhotos/StepVerification) plus the "fix loop" banner (§34-style: exactly what's
 * missing, each linking back to the step that fixes it) for both an admin's earlier
 * "Request Changes" AND a failed submit attempt. */
export function StepReviewSubmit({
  gymId,
  brandName,
  basicInfo,
  location,
  hours,
  facilities,
  openReviewIssues,
  submitIssues,
  submitting,
  onSubmit,
  onGoToStep,
}: {
  gymId: string;
  brandName: string;
  basicInfo: BasicInfoValue;
  location: LocationValue;
  hours: GymOperatingHoursDay[];
  facilities: string[];
  openReviewIssues: { category: BranchReviewCategory; message: string }[];
  submitIssues: SubmitIssue[];
  submitting: boolean;
  onSubmit: () => void;
  onGoToStep: (step: number) => void;
}) {
  const photosQuery = useQuery<GymPhoto[]>({ queryKey: ["gym-photos", gymId], queryFn: () => gymService.listGymPhotos(gymId) });
  const docsQuery = useQuery<{ documents: GymBranchDocument[] }>({
    queryKey: ["gym-branch-documents", gymId],
    queryFn: () => gymService.listBranchDocuments(gymId),
  });

  const photos = photosQuery.data ?? [];
  const cover = photos.find((p) => p.isCover) ?? photos[0];
  const documents = docsQuery.data?.documents ?? [];
  const missingRequiredDocs = documents.filter((d) => d.required && !d.fileToken);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Xem lại & Gửi</h1>
        <p className="text-sm text-zinc-500 mt-1">Kiểm tra lại toàn bộ thông tin trước khi gửi cho Gymini duyệt.</p>
      </div>

      {openReviewIssues.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-amber-400 mb-1.5">Admin đã yêu cầu chỉnh sửa những mục sau trước khi duyệt:</p>
          <ul className="space-y-1.5">
            {openReviewIssues.map((issue, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-xs text-amber-300/90">
                <span>
                  <span className="font-semibold">{CATEGORY_LABEL[issue.category]}:</span> {issue.message}
                </span>
                {CATEGORY_STEP[issue.category] != null && (
                  <button type="button" onClick={() => onGoToStep(CATEGORY_STEP[issue.category]!)} className="shrink-0 underline hover:text-amber-200">
                    Đi tới bước
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitIssues.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs font-semibold text-red-400 mb-1.5">Chưa gửi được — còn thiếu:</p>
          <ul className="space-y-1.5">
            {submitIssues.map((issue, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-xs text-red-400/90">
                <span>{issue.message}</span>
                {FIELD_STEP[issue.field] != null && (
                  <button type="button" onClick={() => onGoToStep(FIELD_STEP[issue.field])} className="shrink-0 underline hover:text-red-300">
                    Đi tới bước
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReviewSection title="Thông tin cơ bản" onEdit={() => onGoToStep(1)}>
        <p className="text-sm text-zinc-500">Thương hiệu: <span className="text-zinc-300">{brandName}</span></p>
        <p className="text-sm font-semibold text-zinc-200 mt-1">{basicInfo.name || "(chưa đặt tên)"}</p>
        {basicInfo.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{basicInfo.description}</p>}
        <p className="text-xs text-zinc-500 mt-1">{basicInfo.phone || "—"} · {basicInfo.email || "—"}</p>
      </ReviewSection>

      <ReviewSection title="Địa điểm" onEdit={() => onGoToStep(2)}>
        <p className="text-sm text-zinc-300">{location.address || "(chưa nhập địa chỉ)"}</p>
        {location.locationNote && <p className="text-xs text-zinc-500 mt-1">{location.locationNote}</p>}
      </ReviewSection>

      <ReviewSection title="Giờ hoạt động" onEdit={() => onGoToStep(3)}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-zinc-400">
          {hours.map((d) => (
            <p key={d.day}>
              {DAY_LABEL[d.day]}: <span className="text-zinc-300">{hoursSummaryLine(d)}</span>
            </p>
          ))}
        </div>
      </ReviewSection>

      <ReviewSection title="Tiện ích & Dịch vụ" onEdit={() => onGoToStep(4)}>
        {facilities.length === 0 ? (
          <p className="text-xs text-zinc-600">Chưa chọn tiện ích nào.</p>
        ) : (
          <p className="text-xs text-zinc-400">{facilities.map((f) => FACILITY_LABEL[f as keyof typeof FACILITY_LABEL] ?? f).join(", ")}</p>
        )}
      </ReviewSection>

      <ReviewSection title="Hình ảnh" onEdit={() => onGoToStep(5)}>
        {photosQuery.isLoading ? (
          <CircleNotchIcon className="size-4 text-zinc-600 animate-spin" />
        ) : photos.length === 0 ? (
          <p className="text-xs text-zinc-600">Chưa có ảnh nào.</p>
        ) : (
          <div className="flex items-center gap-2">
            {cover && <img src={gymPhotoUrl(cover.fileName, cover.url)} alt="" className="size-12 rounded-lg object-cover border border-zinc-800" />}
            <p className="text-xs text-zinc-400">{photos.length} ảnh</p>
          </div>
        )}
      </ReviewSection>

      <ReviewSection title="Xác minh" onEdit={() => onGoToStep(6)}>
        {docsQuery.isLoading ? (
          <CircleNotchIcon className="size-4 text-zinc-600 animate-spin" />
        ) : missingRequiredDocs.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircleIcon className="size-4" /> Đã nộp đủ giấy tờ bắt buộc
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-amber-400">
            <WarningCircleIcon className="size-4" /> Còn thiếu {missingRequiredDocs.length} giấy tờ bắt buộc
          </p>
        )}
      </ReviewSection>

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-black font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {submitting && <CircleNotchIcon className="size-4 animate-spin" />}
        {submitting ? "Đang gửi..." : "Gửi duyệt"}
      </button>
    </div>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</p>
        <button type="button" onClick={onEdit} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-primary">
          <PencilSimpleIcon className="size-3.5" /> Sửa
        </button>
      </div>
      {children}
    </div>
  );
}
