import { useQuery } from "@tanstack/react-query";
import { CircleNotchIcon, InfoIcon, FileTextIcon } from "@phosphor-icons/react";
import { adminService, gymPhotoUrl } from "../../services/api";
import { AuthenticatedImage } from "../ui/AuthenticatedImage";
import { FACILITY_LABEL } from "../gym/AddBranchWizard/StepFacilities";
import type { Gym, GymOperatingHoursDay, GymPhoto, GymBranchDocument, PartnerDocumentContext, PartnerDocumentStatus, BranchDocumentType } from "../../types";

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Thứ 2", TUESDAY: "Thứ 3", WEDNESDAY: "Thứ 4", THURSDAY: "Thứ 5", FRIDAY: "Thứ 6", SATURDAY: "Thứ 7", SUNDAY: "Chủ nhật",
};
function minutesToTime(m: number | null): string {
  if (m == null) return "";
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}
function hoursLine(day: GymOperatingHoursDay): string {
  if (day.type === "CLOSED") return "Đóng cửa";
  if (day.type === "ALL_DAY") return "Mở 24 giờ";
  return `${minutesToTime(day.openMinute)} - ${minutesToTime(day.closeMinute)}`;
}

const DOC_LABEL: Record<BranchDocumentType, string> = {
  LEASE_OR_PROPERTY_DOC: "Hợp đồng thuê / giấy tờ sở hữu mặt bằng",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
  FACILITY_PHOTOS: "Ảnh thực địa cơ sở vật chất",
};
const PARTNER_DOC_LABEL: Record<string, string> = {
  BUSINESS_LICENSE: "Giấy phép kinh doanh", REPRESENTATIVE_ID: "CCCD người đại diện", PREMISES_PROOF: "Giấy tờ mặt bằng (đối tác)",
  TAX_CODE_CERTIFICATE: "Chứng nhận mã số thuế", SITE_PHOTOS: "Ảnh thực địa (đối tác)", FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC (đối tác)",
};
const STATUS_LABEL: Record<PartnerDocumentStatus, string> = { PENDING: "Chưa nộp", RECEIVED: "Đang chờ xem xét", VERIFIED: "Đã xác minh", REJECTED: "Bị từ chối" };

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. Everything the 7-step wizard
 * collected, in one place, so "Duyệt" is an informed decision rather than a blind click off
 * a bare name/address card. §95.3 — if this branch's brand has never had a branch approved
 * before (`approvedName === null`), an explicit callout says approving this branch ALSO
 * approves that pending brand name publicly.
 */
export function BranchReviewDetail({ gym }: { gym: Gym }) {
  const hoursQuery = useQuery<GymOperatingHoursDay[]>({ queryKey: ["admin-gym-hours", gym.id], queryFn: () => adminService.getGymHoursForAdmin(gym.id) });
  const photosQuery = useQuery<GymPhoto[]>({ queryKey: ["admin-gym-photos", gym.id], queryFn: () => adminService.listGymPhotosForAdmin(gym.id) });
  const docsQuery = useQuery<{ documents: GymBranchDocument[]; partnerContext: PartnerDocumentContext[] }>({
    queryKey: ["admin-gym-branch-documents", gym.id],
    queryFn: () => adminService.listBranchDocumentsForAdmin(gym.id),
  });

  const isFirstBranchOfBrand = !!gym.brand && gym.brand.approvedName == null;

  return (
    <div className="space-y-4 text-sm">
      {isFirstBranchOfBrand && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <InfoIcon className="size-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            Đây là chi nhánh ĐẦU TIÊN của thương hiệu <strong>"{gym.brand?.pendingName ?? gym.brand?.name}"</strong> — thương hiệu này
            chưa từng có chi nhánh nào được duyệt. <strong>Duyệt chi nhánh này cũng đồng thời duyệt luôn tên thương hiệu ở trên hiển thị công khai.</strong>
          </p>
        </div>
      )}

      <Section title="Thông tin cơ bản">
        <p className="text-zinc-300">{gym.description || <span className="text-zinc-600">Chưa có mô tả</span>}</p>
        <p className="text-xs text-zinc-500 mt-1">{gym.phone || "—"} · {gym.email || "—"}</p>
      </Section>

      <Section title="Địa điểm">
        <p className="text-zinc-300">{gym.address}{gym.city ? `, ${gym.city}` : ""}</p>
        {gym.locationNote && <p className="text-xs text-zinc-500 mt-1">{gym.locationNote}</p>}
      </Section>

      <Section title="Giờ hoạt động">
        {hoursQuery.isLoading ? (
          <CircleNotchIcon className="size-4 text-zinc-600 animate-spin" />
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            {(hoursQuery.data ?? []).map((d) => (
              <p key={d.day}>{DAY_LABEL[d.day]}: <span className="text-zinc-300">{hoursLine(d)}</span></p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Tiện ích & Dịch vụ">
        {!gym.facilities || gym.facilities.length === 0 ? (
          <p className="text-xs text-zinc-600">Chưa chọn tiện ích nào.</p>
        ) : (
          <p className="text-xs text-zinc-400">{gym.facilities.map((f) => FACILITY_LABEL[f] ?? f).join(", ")}</p>
        )}
      </Section>

      <Section title="Hình ảnh">
        {photosQuery.isLoading ? (
          <CircleNotchIcon className="size-4 text-zinc-600 animate-spin" />
        ) : (photosQuery.data ?? []).length === 0 ? (
          <p className="text-xs text-zinc-600">Chưa có ảnh nào.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {(photosQuery.data ?? []).map((p) => (
              <img key={p.id} src={gymPhotoUrl(p.fileName)} alt="" className="w-full aspect-square object-cover rounded-lg border border-zinc-800" />
            ))}
          </div>
        )}
      </Section>

      <Section title="Xác minh">
        {docsQuery.isLoading ? (
          <CircleNotchIcon className="size-4 text-zinc-600 animate-spin" />
        ) : (
          <div className="space-y-2">
            {(docsQuery.data?.documents ?? []).map((doc) => (
              <div key={doc.docType} className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-300">{DOC_LABEL[doc.docType]}{!doc.required && <span className="text-zinc-600"> (tuỳ chọn)</span>}</p>
                  <span className="text-[11px] text-zinc-500">{STATUS_LABEL[doc.status]}</span>
                </div>
                {doc.fileToken && <DocPreview token={doc.fileToken} label={DOC_LABEL[doc.docType]} />}
              </div>
            ))}
            {(docsQuery.data?.partnerContext ?? []).length > 0 && (
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Giấy tờ đối tác đã nộp (thẩm định một lần)</p>
                <div className="space-y-1">
                  {(docsQuery.data?.partnerContext ?? []).map((d) => (
                    <div key={d.docType} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">{PARTNER_DOC_LABEL[d.docType] ?? d.docType}</span>
                      <span className="text-zinc-400">{STATUS_LABEL[d.status]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function DocPreview({ token, label }: { token: string; label: string }) {
  const isPdf = token.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    return (
      <button
        type="button"
        onClick={async () => {
          const blob = await adminService.fetchBranchDocumentBlob(token);
          window.open(URL.createObjectURL(blob), "_blank");
        }}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 mt-1.5"
      >
        <FileTextIcon className="size-4" /> Xem tệp PDF
      </button>
    );
  }
  return (
    <div className="mt-1.5">
      <AuthenticatedImage fetchBlob={() => adminService.fetchBranchDocumentBlob(token)} alt={label} className="w-20 h-20" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">{title}</p>
      {children}
    </div>
  );
}
