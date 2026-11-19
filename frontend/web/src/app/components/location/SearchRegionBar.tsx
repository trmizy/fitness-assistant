import {
  MapPinIcon as MapPin,
  NavigationArrowIcon as Navigation,
  GlobeIcon as Globe,
  CircleNotchIcon as Loader2,
  XIcon as X,
  WarningCircleIcon as AlertCircle,
} from "@phosphor-icons/react";
import { RADIUS_STEPS, type Coords, type SearchScope } from "../../utils/discoverySearch";

export type GpsStatus = "idle" | "locating" | "granted" | "denied" | "unsupported";

export interface RegionItem {
  code: number;
  name: string;
}

interface SearchRegionBarProps {
  scope: SearchScope;
  national: boolean;
  provinceCode: number | null;
  wardCode: number | null;
  radiusKm: number;
  provinces: RegionItem[];
  wards: RegionItem[];
  gpsCoords: Coords | null;
  gpsStatus: GpsStatus;
  savingRegion?: boolean;
  onSelectNational: () => void;
  onSelectProvince: (code: number | null) => void;
  onSelectWard: (code: number | null) => void;
  onRequestGps: () => void;
  onClearGps: () => void;
  onRadiusChange: (km: number) => void;
}

export function SearchRegionBar({
  scope,
  national,
  provinceCode,
  wardCode,
  radiusKm,
  provinces,
  wards,
  gpsCoords,
  gpsStatus,
  savingRegion = false,
  onSelectNational,
  onSelectProvince,
  onSelectWard,
  onRequestGps,
  onClearGps,
  onRadiusChange,
}: SearchRegionBarProps) {
  const showRadius = scope === "near" && (!!gpsCoords || !!wardCode);
  const selectedProv = provinces.find((p) => p.code === provinceCode);
  const selectedWard = wards.find((w) => w.code === wardCode);

  const summaryText = national
    ? "Toàn quốc"
    : gpsCoords
      ? `Vị trí hiện tại (bán kính ${radiusKm} km)`
      : selectedWard
        ? `${selectedWard.name}, ${selectedProv?.name ?? ""}`
        : selectedProv
          ? selectedProv.name
          : "Toàn quốc";

  return (
    <section
      aria-label="Khu vực tìm kiếm"
      data-testid="search-region-bar"
      className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-3 sm:p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-green-400 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
            Khu vực tìm kiếm
          </span>
          <span
            data-testid="active-region-summary"
            className="text-xs text-zinc-400 truncate max-w-[200px] sm:max-w-xs"
          >
            · {summaryText}
          </span>
          {savingRegion && <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin shrink-0" />}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            data-testid="region-national-btn"
            aria-pressed={national && !gpsCoords}
            onClick={onSelectNational}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              national && !gpsCoords
                ? "bg-green-500 text-black border-green-500"
                : "bg-zinc-800/80 border-zinc-700/60 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            Toàn quốc
          </button>

          {gpsCoords ? (
            <button
              type="button"
              data-testid="region-clear-gps-btn"
              onClick={onClearGps}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-500/40 bg-blue-500/15 text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              <Navigation className="w-3.5 h-3.5 shrink-0" />
              Đang dùng GPS
              <X className="w-3 h-3 ml-0.5 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="region-gps-btn"
              onClick={onRequestGps}
              disabled={gpsStatus === "locating"}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-700/60 bg-zinc-800/80 text-zinc-200 hover:border-green-500/50 hover:text-green-400 disabled:opacity-60 transition-colors"
            >
              {gpsStatus === "locating" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Navigation className="w-3.5 h-3.5 shrink-0" />
              )}
              Dùng vị trí hiện tại
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 items-end">
        <div className="min-w-0">
          <label
            htmlFor="region-province-select"
            className="text-[11px] font-medium text-zinc-500 block mb-1"
          >
            Tỉnh / Thành phố
          </label>
          <select
            id="region-province-select"
            aria-label="Khu vực tỉnh thành phố"
            value={provinceCode ?? ""}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              onSelectProvince(v);
            }}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
          >
            <option value="">Toàn quốc</option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label
            htmlFor="region-ward-select"
            className="text-[11px] font-medium text-zinc-500 block mb-1"
          >
            Phường / Xã
          </label>
          <select
            id="region-ward-select"
            aria-label="Khu vực phường xã"
            value={wardCode ?? ""}
            disabled={!provinceCode || wards.length === 0}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              onSelectWard(v);
            }}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 disabled:opacity-50"
          >
            <option value="">{provinceCode ? "Tất cả phường/xã" : "Chọn tỉnh trước"}</option>
            {wards.map((w) => (
              <option key={w.code} value={w.code}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {showRadius && (
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-zinc-500 block mb-1">
              Bán kính tìm kiếm
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Bán kính tìm kiếm">
              {RADIUS_STEPS.map((km) => (
                <button
                  key={km}
                  type="button"
                  data-testid={`radius-pill-${km}`}
                  aria-pressed={radiusKm === km}
                  onClick={() => onRadiusChange(km)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    radiusKm === km
                      ? "bg-green-500 text-black border-green-500"
                      : "bg-zinc-800 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {km} km
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {(gpsStatus === "denied" || gpsStatus === "unsupported") && (
        <div
          role="status"
          data-testid="gps-denied-banner"
          className="flex items-start justify-between gap-2 flex-wrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <span>
              {gpsStatus === "unsupported"
                ? "Trình duyệt không hỗ trợ định vị GPS. Bạn vẫn có thể chọn Tỉnh/Phường hoặc Toàn quốc ở trên."
                : "Trình duyệt chưa cấp quyền vị trí. Bạn vẫn có thể chọn Tỉnh/Phường ở trên hoặc xem Toàn quốc."}
            </span>
          </div>
          {gpsStatus === "denied" && (
            <button
              type="button"
              onClick={onRequestGps}
              className="px-2.5 py-1 rounded-md border border-amber-500/40 font-semibold text-amber-200 hover:bg-amber-500/20 shrink-0"
            >
              Thử lại vị trí
            </button>
          )}
        </div>
      )}
    </section>
  );
}

