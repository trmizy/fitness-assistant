import { useEffect, useMemo, useState } from "react";
import {
  BarbellIcon as Dumbbell,
  MapPinIcon as MapPin,
  CircleNotchIcon as Loader2,
  MagnifyingGlassIcon as Search,
  BuildingsIcon as Building2,
  CaretDownIcon as ChevronDown,
  FunnelIcon as Filter,
  XIcon as X,
  NavigationArrowIcon as Navigation,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { gymService, locationService } from "../../services/api";
import type { Gym } from "../../types";
import { Stars } from "../../components/gym/Stars";
import { GymDetailModal } from "../../components/gym/GymDetailModal";
import { formatVND } from "../../utils/currency";

// ── Vị trí khách đang tìm kiếm + khoảng cách ─────────────────────────────────
// Đúng như đã chốt với Ngài: đây là vị trí của CHÍNH KHÁCH đang mở trang này (khác toạ độ
// cố định của từng chi nhánh, do chủ gym tự lấy một lần lúc tạo/sửa) — không có cách nào
// khác để biết khách đang ở đâu ngoài hỏi thẳng trình duyệt của họ.
function useUserLocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "granted" | "denied" | "unsupported">("idle");

  const request = () => {
    if (!navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return { coords, status, request };
}

/** Công thức Haversine — khoảng cách đường chim bay giữa hai toạ độ, tính bằng km. Đủ
 * chính xác cho "chi nhánh nào gần bạn hơn", không cần định tuyến đường bộ thật. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function gymDistance(user: { lat: number; lng: number } | null, gym: Gym): number | null {
  if (!user || gym.latitude == null || gym.longitude == null) return null;
  return distanceKm(user, { lat: gym.latitude, lng: gym.longitude });
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// ── Nhóm theo thương hiệu + lọc ───────────────────────────────────────────────

interface StandaloneEntry {
  kind: "standalone";
  gym: Gym;
  distance: number | null;
}
interface BrandEntry {
  kind: "brand";
  brandId: string;
  brandName: string;
  branches: { gym: Gym; distance: number | null }[];
  nearestDistance: number | null;
  fromPrice: string | null;
}
type SearchEntry = StandaloneEntry | BrandEntry;

function groupByBrand(gyms: Gym[], userCoords: { lat: number; lng: number } | null): SearchEntry[] {
  const byBrand = new Map<string, Gym[]>();
  const standalone: Gym[] = [];
  for (const g of gyms) {
    if (!g.brand) {
      standalone.push(g);
      continue;
    }
    const list = byBrand.get(g.brand.id) ?? [];
    list.push(g);
    byBrand.set(g.brand.id, list);
  }

  const entries: SearchEntry[] = [];
  for (const [brandId, branchesRaw] of byBrand) {
    if (branchesRaw.length >= 2) {
      // Chi nhánh gần khách nhất lên đầu danh sách — yêu cầu của Ngài. Chi nhánh không có
      // toạ độ (chủ gym chưa lấy vị trí) xếp cuối, không mặc định coi là gần.
      const branches = branchesRaw
        .map((gym) => ({ gym, distance: gymDistance(userCoords, gym) }))
        .sort((a, b) => {
          if (a.distance == null && b.distance == null) return 0;
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
          return a.distance - b.distance;
        });
      const distances = branches.map((b) => b.distance).filter((d): d is number => d != null);
      entries.push({
        kind: "brand",
        brandId,
        brandName: branchesRaw[0].brand!.name,
        branches,
        nearestDistance: distances.length > 0 ? Math.min(...distances) : null,
        fromPrice: branchesRaw[0].fromPrice ?? null,
      });
    } else {
      standalone.push(...branchesRaw);
    }
  }
  for (const gym of standalone) entries.push({ kind: "standalone", gym, distance: gymDistance(userCoords, gym) });

  // Sắp toàn bộ kết quả theo khoảng cách khi đã có vị trí khách — không có toạ độ thì giữ
  // nguyên thứ tự gốc (mới duyệt gần đây nhất trước, như trước giờ).
  if (userCoords) {
    entries.sort((a, b) => {
      const da = a.kind === "brand" ? a.nearestDistance : a.distance;
      const db = b.kind === "brand" ? b.nearestDistance : b.distance;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }
  return entries;
}

const PRICE_BUCKETS = [
  { key: "under300", label: "Dưới 300k", test: (p: number) => p < 300_000 },
  { key: "300to500", label: "300k - 500k", test: (p: number) => p >= 300_000 && p <= 500_000 },
  { key: "500to1m", label: "500k - 1 triệu", test: (p: number) => p > 500_000 && p <= 1_000_000 },
  { key: "over1m", label: "Trên 1 triệu", test: (p: number) => p > 1_000_000 },
] as const;

function entryFromPrice(entry: SearchEntry): number | null {
  const raw = entry.kind === "brand" ? entry.fromPrice : entry.gym.fromPrice;
  return raw != null ? Number(raw) : null;
}

function matchesFilters(
  entry: SearchEntry,
  q: string,
  provinceCode: number | null,
  priceBucket: string | null,
): boolean {
  if (q) {
    const query = q.toLowerCase();
    const hit =
      entry.kind === "standalone"
        ? entry.gym.name.toLowerCase().includes(query) || (entry.gym.city ?? "").toLowerCase().includes(query)
        : entry.brandName.toLowerCase().includes(query) ||
          entry.branches.some((b) => b.gym.name.toLowerCase().includes(query) || (b.gym.city ?? "").toLowerCase().includes(query));
    if (!hit) return false;
  }
  if (provinceCode) {
    const branches = entry.kind === "standalone" ? [entry.gym] : entry.branches.map((b) => b.gym);
    if (!branches.some((b) => b.provinceCode === provinceCode)) return false;
  }
  if (priceBucket) {
    const bucket = PRICE_BUCKETS.find((b) => b.key === priceBucket);
    const price = entryFromPrice(entry);
    if (!bucket || price == null || !bucket.test(price)) return false;
  }
  return true;
}

// ── Thẻ kết quả ───────────────────────────────────────────────────────────────

function PriceTag({ fromPrice }: { fromPrice: string | null }) {
  if (fromPrice == null) return null;
  return <div className="text-xs font-bold text-green-400 mt-1.5">Từ {formatVND(Number(fromPrice))}</div>;
}

function GymResultCard({ gym, distance, onSelect }: { gym: Gym; distance: number | null; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 hover:border-green-500/40 hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500/20 to-green-500/5 flex items-center justify-center">
          <Dumbbell className="w-5 h-5 text-green-400" />
        </div>
        {distance != null && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5">
            <Navigation className="w-3 h-3" /> {formatDistance(distance)}
          </span>
        )}
      </div>
      <div className="text-sm font-bold text-zinc-100 mb-1 truncate">{gym.name}</div>
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{gym.address}{gym.city ? `, ${gym.city}` : ""}</span>
      </div>
      {typeof gym.reviewCount === "number" && gym.reviewCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1.5">
          <Stars value={gym.averageRating ?? 0} /> {(gym.averageRating ?? 0).toFixed(1)} <span className="text-zinc-600">({gym.reviewCount})</span>
        </div>
      )}
      <PriceTag fromPrice={gym.fromPrice ?? null} />
    </button>
  );
}

function BrandResultCard({ entry, onSelectGym }: { entry: BrandEntry; onSelectGym: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 overflow-hidden hover:border-green-500/30 transition-colors">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left p-4 hover:bg-zinc-800/30 transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500/20 to-green-500/5 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-green-400" />
          </div>
          <div className="flex items-center gap-2">
            {entry.nearestDistance != null && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5">
                <Navigation className="w-3 h-3" /> {formatDistance(entry.nearestDistance)}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </div>
        <div className="text-sm font-bold text-zinc-100 mb-1">{entry.brandName}</div>
        <div className="text-xs text-zinc-500">{entry.branches.length} chi nhánh — bấm để xem</div>
        <PriceTag fromPrice={entry.fromPrice} />
      </button>
      {open && (
        <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/60">
          {entry.branches.map(({ gym: b, distance }, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelectGym(b.id)}
              className="w-full text-left px-4 py-3 hover:bg-zinc-800/30 transition-colors flex items-center justify-between gap-2"
            >
              <div className="flex items-start gap-2 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 flex-wrap">
                    {i === 0 && distance != null && (
                      <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5">Gần bạn nhất</span>
                    )}
                    {b.address}{b.city ? `, ${b.city}` : ""}
                  </div>
                  {typeof b.reviewCount === "number" && b.reviewCount > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-zinc-500 mt-0.5">
                      <Stars value={b.averageRating ?? 0} /> {(b.averageRating ?? 0).toFixed(1)}
                    </div>
                  )}
                </div>
              </div>
              {distance != null && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 flex-shrink-0">
                  <Navigation className="w-3 h-3" /> {formatDistance(distance)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trang chính ──────────────────────────────────────────────────────────────

export function GymsPage() {
  const [search, setSearch] = useState("");
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [provinceCode, setProvinceCode] = useState<number | null>(null);
  const [priceBucket, setPriceBucket] = useState<string | null>(null);
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>([]);
  const { coords: userCoords, status: locationStatus, request: requestLocation } = useUserLocation();

  useEffect(() => {
    locationService.getProvinces().then(setProvinces).catch(() => {});
  }, []);

  // Tự hỏi vị trí một lần khi vào trang — im lặng nếu khách từ chối, không ép lại.
  useEffect(() => {
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: gyms = [], isLoading } = useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: () => gymService.listGyms(),
  });

  const entries = useMemo(() => {
    const grouped = groupByBrand(gyms, userCoords);
    return grouped.filter((e) => matchesFilters(e, search, provinceCode, priceBucket));
  }, [gyms, userCoords, search, provinceCode, priceBucket]);

  const activeFilterCount = (provinceCode ? 1 : 0) + (priceBucket ? 1 : 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Dumbbell className="w-5 h-5 text-green-400" /> Tìm phòng gym
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Khám phá phòng gym gần bạn và chọn gói hội viên phù hợp</p>
      </div>

      {/* Search & filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            aria-label="Tìm phòng gym"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên hoặc thành phố..."
            className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-zinc-600 hover:text-zinc-400">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm transition-colors whitespace-nowrap ${
            activeFilterCount > 0 ? "border-green-500/60 bg-green-500/10 text-green-400" : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          <Filter className="w-4 h-4" /> Lọc {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
      </div>

      {/* Vị trí */}
      {locationStatus === "denied" || locationStatus === "unsupported" ? (
        <button
          onClick={requestLocation}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <Navigation className="w-3.5 h-3.5" /> Bật vị trí để thấy chi nhánh gần bạn nhất
        </button>
      ) : locationStatus === "granted" ? (
        <p className="flex items-center gap-1.5 text-xs text-blue-400">
          <Navigation className="w-3.5 h-3.5" /> Đang sắp xếp theo khoảng cách tới bạn
        </p>
      ) : null}

      {/* Filter panel */}
      {filterOpen && (
        <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.37)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-sm font-bold text-zinc-100 tracking-tight">Bộ lọc tìm kiếm</span>
            <button onClick={() => setFilterOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Tỉnh/Thành phố</label>
            <select
              aria-label="Lọc theo tỉnh thành phố"
              value={provinceCode ?? ""}
              onChange={(e) => setProvinceCode(e.target.value ? Number(e.target.value) : null)}
              className="w-full sm:w-64 px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
            >
              <option value="">Tất cả</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Mức giá</label>
            <div className="flex flex-wrap gap-2">
              {PRICE_BUCKETS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setPriceBucket(priceBucket === b.key ? null : b.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    priceBucket === b.key ? "bg-green-500 text-black border-green-500" : "bg-zinc-800 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-3 border-t border-white/10">
            <button
              onClick={() => { setProvinceCode(null); setPriceBucket(null); }}
              className="flex-1 py-2 border border-white/10 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-white/10 transition-colors"
            >
              Xoá bộ lọc
            </button>
            <button
              onClick={() => setFilterOpen(false)}
              className="flex-1 py-2 bg-green-500 hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] text-black text-sm font-bold rounded-lg transition-all"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">Không tìm thấy phòng gym nào</h3>
          <p className="text-sm text-zinc-500">Thử đổi bộ lọc hoặc quay lại sau — phòng gym mới được duyệt liên tục.</p>
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) =>
            entry.kind === "brand" ? (
              <BrandResultCard key={entry.brandId} entry={entry} onSelectGym={setSelectedGymId} />
            ) : (
              <GymResultCard key={entry.gym.id} gym={entry.gym} distance={entry.distance} onSelect={() => setSelectedGymId(entry.gym.id)} />
            ),
          )}
        </div>
      )}

      {selectedGymId && <GymDetailModal gymId={selectedGymId} onClose={() => setSelectedGymId(null)} />}
    </div>
  );
}
