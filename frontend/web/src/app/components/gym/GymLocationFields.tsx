import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPinIcon as MapPin, CircleNotchIcon as Loader2, CheckCircleIcon as CheckCircle2 } from "@phosphor-icons/react";
import { locationService } from "../../services/api";

export interface GymLocationValue {
  provinceCode: number | null;
  wardCode: number | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Dùng chung cho form tạo/sửa chi nhánh (MyGymsPage, GymManagePage) — chủ gym chọn tỉnh/
 * thành (phục vụ bộ lọc "theo tỉnh/thành phố" ở trang tìm kiếm của khách) và tự bấm "Dùng
 * vị trí hiện tại" để lấy toạ độ (phục vụ sắp xếp "chi nhánh gần nhất" — quyết định đã
 * chốt: không tích hợp geocoding API trả phí nào).
 */
export function GymLocationFields({ value, onChange }: { value: GymLocationValue; onChange: (next: GymLocationValue) => void }) {
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>([]);
  const [wards, setWards] = useState<{ code: number; name: string }[]>([]);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    locationService.getProvinces().then(setProvinces).catch(() => {});
  }, []);

  useEffect(() => {
    if (!value.provinceCode) {
      setWards([]);
      return;
    }
    locationService.getWards(value.provinceCode).then(setWards).catch(() => setWards([]));
  }, [value.provinceCode]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Trình duyệt này không hỗ trợ lấy vị trí");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ ...value, latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
        toast.success("Đã lấy vị trí hiện tại");
      },
      () => {
        setLocating(false);
        toast.error("Không lấy được vị trí — hãy cho phép quyền truy cập vị trí của trình duyệt");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">Tỉnh/Thành phố</label>
          <select
            value={value.provinceCode ?? ""}
            onChange={(e) => onChange({ ...value, provinceCode: e.target.value ? Number(e.target.value) : null, wardCode: null })}
            className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
          >
            <option value="">Chưa chọn</option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">Phường/Xã</label>
          <select
            value={value.wardCode ?? ""}
            onChange={(e) => onChange({ ...value, wardCode: e.target.value ? Number(e.target.value) : null })}
            disabled={!value.provinceCode}
            className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 disabled:opacity-40"
          >
            <option value="">Chưa chọn</option>
            {wards.map((w) => (
              <option key={w.code} value={w.code}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={locating}
        className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
          value.latitude != null ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
        }`}
      >
        {locating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : value.latitude != null ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : (
          <MapPin className="w-3.5 h-3.5" />
        )}
        {value.latitude != null ? "Đã lấy vị trí — bấm để cập nhật lại" : "Dùng vị trí hiện tại của tôi"}
      </button>
      <p className="text-[11px] text-zinc-600">
        Vị trí dùng để hiển thị "chi nhánh gần bạn nhất" khi khách tìm kiếm. Đứng tại chi nhánh lúc bấm để có kết quả chính xác nhất.
      </p>
    </div>
  );
}
