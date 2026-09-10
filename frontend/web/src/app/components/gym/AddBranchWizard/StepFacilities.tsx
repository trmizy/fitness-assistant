import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "../../ui/utils";
import type { GymFacility } from "../../../types";

export const FACILITY_LABEL: Record<GymFacility, string> = {
  FREE_WEIGHTS: "Tạ tự do",
  CARDIO_MACHINES: "Máy cardio",
  FUNCTIONAL_TRAINING_AREA: "Khu tập functional",
  GROUP_CLASSES: "Lớp tập nhóm",
  YOGA_STUDIO: "Phòng Yoga",
  SWIMMING_POOL: "Hồ bơi",
  PERSONAL_TRAINER: "Huấn luyện viên cá nhân",
  INBODY_SCAN: "Máy đo InBody",
  LOCKER_ROOM: "Phòng thay đồ / tủ khoá",
  SHOWER: "Phòng tắm",
  SAUNA: "Xông hơi",
  TOWEL_SERVICE: "Dịch vụ khăn tắm",
  PARKING: "Bãi đỗ xe",
  WIFI: "Wifi miễn phí",
  AIR_CONDITIONING: "Máy lạnh",
  DRINKING_WATER: "Nước uống miễn phí",
  KIDS_AREA: "Khu vui chơi trẻ em",
  VENDING_MACHINE: "Máy bán hàng tự động",
};

const FACILITY_GROUPS: { label: string; items: GymFacility[] }[] = [
  { label: "Thiết bị tập luyện", items: ["FREE_WEIGHTS", "CARDIO_MACHINES", "FUNCTIONAL_TRAINING_AREA", "SWIMMING_POOL", "INBODY_SCAN"] },
  { label: "Lớp học & huấn luyện", items: ["GROUP_CLASSES", "YOGA_STUDIO", "PERSONAL_TRAINER"] },
  { label: "Tiện nghi", items: ["LOCKER_ROOM", "SHOWER", "SAUNA", "TOWEL_SERVICE", "AIR_CONDITIONING", "DRINKING_WATER"] },
  { label: "Khác", items: ["PARKING", "WIFI", "KIDS_AREA", "VENDING_MACHINE"] },
];

/** GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 4 "Facilities & Services". A fixed catalog,
 * multi-select chip grid grouped by category — no free-text entry (§ suggested behavior:
 * "Chip/card grid, grouped by category"). */
export function StepFacilities({ value, onChange }: { value: GymFacility[]; onChange: (next: GymFacility[]) => void }) {
  function toggle(facility: GymFacility) {
    onChange(value.includes(facility) ? value.filter((f) => f !== facility) : [...value, facility]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Tiện ích & Dịch vụ</h1>
        <p className="text-sm text-zinc-500 mt-1">Chọn những tiện ích chi nhánh này thực sự có — khách sẽ thấy danh sách này khi tìm phòng gym.</p>
      </div>

      {FACILITY_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">{group.label}</p>
          <div className="flex flex-wrap gap-2">
            {group.items.map((facility) => {
              const selected = value.includes(facility);
              return (
                <button
                  key={facility}
                  type="button"
                  onClick={() => toggle(facility)}
                  aria-pressed={selected}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border transition-colors",
                    selected ? "bg-primary/10 border-primary/40 text-primary" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
                  )}
                >
                  {selected && <CheckIcon className="size-3.5" weight="bold" />}
                  {FACILITY_LABEL[facility]}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-zinc-600">Đã chọn {value.length} tiện ích. Có thể sửa lại bất cứ lúc nào, kể cả sau khi chi nhánh đã được duyệt.</p>
    </div>
  );
}
