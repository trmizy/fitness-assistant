import { CheckCircleIcon as CheckCircle2 } from "@phosphor-icons/react";
import { GymLocationFields, type GymLocationValue } from "../GymLocationFields";

export interface LocationValue extends GymLocationValue {
  address: string;
  locationNote: string;
}

const inputClass =
  "w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50";

/** GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 2 "Location". Two-tier address only
 * (Province/City → Ward — Vietnam abolished the district level 2025-07-01, §95.1), reusing
 * the same GymLocationFields component the old create/edit dialogs already use. No
 * forward-geocoding, no map library — coordinate confirmation is a plain honest status line,
 * not a fake interactive pin (decision already made before this phase, see
 * GYM_BRANCH_FORM_API_GAPS.md §12). */
export function StepLocation({ value, onChange }: { value: LocationValue; onChange: (next: LocationValue) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Địa điểm</h1>
        <p className="text-sm text-zinc-500 mt-1">Địa chỉ chi nhánh — dùng để khách tìm kiếm và sắp xếp theo khoảng cách.</p>
      </div>

      <div>
        <label className="text-xs text-zinc-500 mb-1.5 block">
          Địa chỉ (số nhà, tên đường) <span className="text-red-400">*</span>
        </label>
        <input
          aria-label="Địa chỉ"
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder="123 Nguyễn Huệ"
          maxLength={300}
          className={inputClass}
        />
      </div>

      <GymLocationFields value={value} onChange={(next) => onChange({ ...value, ...next })} />

      <div>
        <label className="text-xs text-zinc-500 mb-1.5 block">Hướng dẫn tới nơi (tuỳ chọn)</label>
        <input
          aria-label="Hướng dẫn tới nơi"
          value={value.locationNote}
          onChange={(e) => onChange({ ...value, locationNote: e.target.value })}
          placeholder="Ví dụ: Toà nhà màu xanh, cổng sau, tầng 3"
          maxLength={300}
          className={inputClass}
        />
        <p className="text-[11px] text-zinc-600 mt-1">Hiển thị thêm cho khách bên cạnh địa chỉ chính thức — có thể sửa bất cứ lúc nào, kể cả sau khi chi nhánh đã được duyệt.</p>
      </div>

      {value.latitude != null && value.longitude != null && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2.5 text-xs text-green-400">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            Toạ độ đã ghi nhận ({value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}) — Gymini sẽ kiểm tra vị trí thủ công trước khi duyệt, chưa hiển thị bản đồ tương tác ở bước này.
          </span>
        </div>
      )}
    </div>
  );
}

export function validateLocation(value: LocationValue): string[] {
  const issues: string[] = [];
  if (!value.address.trim()) issues.push("Cần nhập địa chỉ chi nhánh");
  if (!value.provinceCode) issues.push("Cần chọn Tỉnh/Thành phố");
  if (!value.wardCode) issues.push("Cần chọn Phường/Xã");
  return issues;
}
