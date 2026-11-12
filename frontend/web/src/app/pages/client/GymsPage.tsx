import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarbellIcon as Dumbbell,
  MapPinIcon as MapPin,
  CircleNotchIcon as Loader2,
  MagnifyingGlassIcon as Search,
  FunnelIcon as Filter,
  XIcon as X,
  NavigationArrowIcon as Navigation,
  InfoIcon as Info,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { API_URL, gymService, locationService, profileService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import type { GymSearchResultItem } from "../../types";
import { Stars } from "../../components/gym/Stars";
import { GymDetailModal } from "../../components/gym/GymDetailModal";
import { formatVND } from "../../utils/currency";
import { ListingImage } from "../../components/listing/ListingImage";
import { AmenityIcon } from "../../components/listing/AmenityIcon";
import { cardAmenityChips, coverUrlOf } from "../../utils/gymPublic";
import { mergeUniquePages, nextCursorParam } from "../../utils/ptPaging";
import { SearchRegionBar, type GpsStatus, type RegionItem } from "../../components/location/SearchRegionBar";
import {
  DEFAULT_RADIUS_KM,
  buildGymSearchBody,
  formatGymDistanceBadge,
  gymDiscoveryKeys,
  isCursorResetError,
  isSearchRegionReady,
  nextRadiusStep,
  normalizeVnCoords,
  ptDiscoveryKeys,
  resolveEffectiveScope,
  type Coords,
  type GymSortBy,
} from "../../utils/discoverySearch";

const PRICE_MAX_OPTIONS = [
  { key: "under300", label: "Dưới 300k", value: 299_999 },
  { key: "under500", label: "Dưới 500k", value: 500_000 },
  { key: "under1m", label: "Dưới 1 triệu", value: 1_000_000 },
] as const;

const SORT_OPTIONS: { value: GymSortBy; label: string }[] = [
  { value: "relevance", label: "Phù hợp nhất" },
  { value: "distance", label: "Gần nhất" },
  { value: "rating", label: "Đánh giá cao nhất" },
  { value: "price", label: "Giá thấp nhất" },
];

function PriceTag({ fromPrice }: { fromPrice: string | null | undefined }) {
  if (fromPrice == null) return null;
  return <div className="text-xs font-bold text-green-400 mt-1.5">Từ {formatVND(Number(fromPrice))}</div>;
}

/** Up to 4 amenity chips (from `amenities`, falling back to the legacy `facilities`) and "+N" for the rest. */
function AmenityChips({ gym }: { gym: GymSearchResultItem }) {
  const { chips, extra } = cardAmenityChips(gym, 4);
  if (chips.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tiện ích">
      {chips.map((a) => (
        <li key={a.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300">
          <AmenityIcon iconKey={a.iconKey} className="size-3 shrink-0" />
          <span className="truncate">{a.name}</span>
        </li>
      ))}
      {extra > 0 && <li className="inline-flex items-center rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-500">+{extra}</li>}
    </ul>
  );
}

function GymResultCard({
  gym,
  badgeText,
  badgeKind,
  onSelect,
}: {
  gym: GymSearchResultItem;
  badgeText: string | null;
  badgeKind: "GPS" | "WARD_CENTER" | "ONLINE" | "NONE";
  onSelect: () => void;
}) {
  const cover = coverUrlOf(gym, API_URL);
  const brandLabel = gym.brand?.approvedName || gym.brand?.name || null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 hover:border-green-500/40 hover:-translate-y-0.5 transition-all w-full min-w-0"
    >
      {cover && <ListingImage url={cover} alt={`Ảnh bìa ${gym.name}`} className="mb-3 h-36 w-full rounded-xl" />}
      <div className="flex items-start justify-between gap-2 mb-2.5 flex-wrap">
        {cover ? (
          brandLabel ? (
            <span className="text-[11px] font-semibold text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-full px-2 py-0.5 truncate max-w-full">
              {brandLabel}
            </span>
          ) : (
            <span />
          )
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center shrink-0">
              <Dumbbell className="w-5 h-5 text-green-400" />
            </div>
            {brandLabel && (
              <span className="text-[11px] font-semibold text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-full px-2 py-0.5 truncate">
                {brandLabel}
              </span>
            )}
          </div>
        )}
        {badgeText && (
          <span
            data-testid="gym-distance-badge"
            className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border max-w-full ${
              badgeKind === "GPS"
                ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
            }`}
          >
            {badgeKind === "GPS" ? <Navigation className="w-3 h-3 shrink-0" /> : <MapPin className="w-3 h-3 shrink-0" />}
            <span className="truncate">{badgeText}</span>
          </span>
        )}
      </div>

      <div className="text-sm font-bold text-zinc-100 mb-1 truncate">{gym.name}</div>
      <div className="flex items-center gap-1 text-xs text-zinc-500 min-w-0">
        <MapPin className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">{gym.address}{gym.city ? `, ${gym.city}` : ""}</span>
      </div>
      {typeof gym.reviewCount === "number" && gym.reviewCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1.5">
          <Stars value={gym.averageRating ?? 0} /> {(gym.averageRating ?? 0).toFixed(1)}{" "}
          <span className="text-zinc-600">({gym.reviewCount})</span>
        </div>
      )}
      <AmenityChips gym={gym} />
      <PriceTag fromPrice={gym.fromPrice ?? null} />
    </button>
  );
}

export function GymsPage() {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useApp();
  const userId = isAuthenticated ? (user?.id ?? null) : null;
  const gymKeys = gymDiscoveryKeys(userId);
  const ptRegionKey = ptDiscoveryKeys(userId).profileRegion();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // Region + GPS state — NEVER prompts geolocation on mount; cleared cleanly across account switches
  const [provinceCode, setProvinceCode] = useState<number | null>(null);
  const [wardCode, setWardCode] = useState<number | null>(null);
  const [national, setNational] = useState(true);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [gpsCoords, setGpsCoords] = useState<Coords | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [wards, setWards] = useState<RegionItem[]>([]);

  // Extra filters & sorting (server-side on POST /gyms/search)
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [knownAmenities, setKnownAmenities] = useState<Map<string, { slug: string; name: string; iconKey: string }>>(
    () => new Map(),
  );
  const [sort, setSort] = useState<GymSortBy>("relevance");
  const [cursorResetSeq, setCursorResetSeq] = useState(0);
  const [listUpdatedNotice, setListUpdatedNotice] = useState(false);

  const hydratedUserRef = useRef<string | null>(null);
  const userChangedRegionRef = useRef(false);
  // The user id whose saved region has been applied to the state above. The first search waits for it so a
  // stale scope:"national" request is never sent before the saved area resolves.
  const [regionHydratedFor, setRegionHydratedFor] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Isolate UI state immediately on account switch / logout
  useEffect(() => {
    hydratedUserRef.current = null;
    userChangedRegionRef.current = false;
    setProvinceCode(null);
    setWardCode(null);
    setNational(true);
    setRadiusKm(DEFAULT_RADIUS_KM);
    setGpsCoords(null);
    setGpsStatus("idle");
    setWards([]);
    setSelectedGymId(null);
    setCursorResetSeq(0);
    setListUpdatedNotice(false);
  }, [userId]);

  const { data: provinces = [] } = useQuery<RegionItem[]>({
    queryKey: ["locations", "provinces"],
    queryFn: () => locationService.getProvinces(),
    staleTime: 24 * 60 * 60_000,
  });

  const {
    data: profileRegion,
    isSuccess: profileRegionLoaded,
    isError: profileRegionFailed,
  } = useQuery<{ searchProvinceCode?: number | null; searchWardCode?: number | null } | null>({
    queryKey: ptRegionKey,
    queryFn: async () => (await profileService.getProfile())?.profile ?? null,
    enabled: !!userId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!userId || !profileRegionLoaded || hydratedUserRef.current === userId) return;
    hydratedUserRef.current = userId;
    setRegionHydratedFor(userId);
    if (userChangedRegionRef.current) return;
    const pCode = typeof profileRegion?.searchProvinceCode === "number" ? profileRegion.searchProvinceCode : null;
    const wCode = pCode && typeof profileRegion?.searchWardCode === "number" ? profileRegion.searchWardCode : null;
    setProvinceCode(pCode);
    setWardCode(wCode);
    setNational(!pCode);
    if (pCode) {
      locationService.getWards(pCode).then(setWards).catch(() => setWards([]));
    } else {
      setWards([]);
    }
  }, [userId, profileRegion, profileRegionLoaded]);

  const regionReady = isSearchRegionReady({ userId, hydratedForUserId: regionHydratedFor, profileRegionFailed });

  const saveRegionMutation = useMutation({
    mutationFn: (payload: { searchProvinceCode: number | null; searchWardCode: number | null }) =>
      profileService.updateProfile(payload),
    onSuccess: (res: any, payload) => {
      queryClient.setQueryData(ptRegionKey, (prev: any) => ({
        ...(prev ?? {}),
        ...(res?.profile ?? {}),
        searchProvinceCode: payload.searchProvinceCode,
        searchWardCode: payload.searchWardCode,
      }));
    },
    onError: () => {
      toast.error("Không thể lưu khu vực tìm kiếm");
    },
  });

  const effectiveScope = resolveEffectiveScope({
    national,
    hasGps: !!gpsCoords,
    provinceCode,
    wardCode,
  });

  const searchBody = useMemo(
    () =>
      buildGymSearchBody({
        gpsCoords,
        provinceCode,
        wardCode,
        national,
        radiusKm,
        q: debouncedQ,
        amenityIds: selectedAmenities,
        priceMax,
        sort,
        limit: 20,
      }),
    [gpsCoords, provinceCode, wardCode, national, radiusKm, debouncedQ, selectedAmenities, priceMax, sort],
  );

  const queryKey = gymKeys.search(searchBody, cursorResetSeq);

  const {
    data,
    isLoading: searchLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    queryKey,
    enabled: regionReady,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: any) => nextCursorParam(lastPage),
    queryFn: ({ pageParam }) =>
      gymService.searchGyms({
        ...searchBody,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
  });

  // While the saved region is still resolving the query is disabled (not "loading"): show the skeleton, never "no results".
  const isLoading = searchLoading || !regionReady;

  // Handle 409 CURSOR_EXPIRED / CURSOR_FILTER_MISMATCH by resetting to page 1 transparently
  useEffect(() => {
    const code = isCursorResetError(error);
    if (!code || (!isError && !isFetchNextPageError)) return;
    toast.info("Danh sách đã cập nhật");
    setListUpdatedNotice(true);
    setCursorResetSeq((s) => s + 1);
  }, [error, isError, isFetchNextPageError]);

  const gymsList = useMemo(
    () => mergeUniquePages(data?.pages, (p: any) => p?.gyms, (g: GymSearchResultItem) => g.id),
    [data?.pages],
  );

  // Collect real amenity slugs seen in results so users can filter without guessing backend IDs
  useEffect(() => {
    if (gymsList.length === 0) return;
    setKnownAmenities((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const g of gymsList) {
        if (!Array.isArray(g.amenities)) continue;
        for (const a of g.amenities as any[]) {
          if (a?.slug && a?.name && !next.has(a.slug)) {
            next.set(a.slug, { slug: String(a.slug), name: String(a.name), iconKey: String(a.iconKey ?? "") });
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [gymsList]);

  const appliedScope = data?.pages?.[data.pages.length - 1]?.appliedScope ?? effectiveScope;
  const selectedWardName = wards.find((w) => w.code === wardCode)?.name ?? null;

  const handleSelectNational = () => {
    userChangedRegionRef.current = true;
    setNational(true);
    setProvinceCode(null);
    setWardCode(null);
    setWards([]);
    setGpsCoords(null);
    setGpsStatus("idle");
    setListUpdatedNotice(false);
    if (userId) {
      saveRegionMutation.mutate({ searchProvinceCode: null, searchWardCode: null });
    }
  };

  const handleSelectProvince = async (code: number | null) => {
    if (!code) {
      handleSelectNational();
      return;
    }
    userChangedRegionRef.current = true;
    setNational(false);
    setProvinceCode(code);
    setWardCode(null);
    setGpsCoords(null);
    setGpsStatus("idle");
    setListUpdatedNotice(false);
    if (userId) {
      saveRegionMutation.mutate({ searchProvinceCode: code, searchWardCode: null });
    }
    const nextWards = await locationService.getWards(code).catch(() => []);
    setWards(nextWards);
  };

  const handleSelectWard = (code: number | null) => {
    userChangedRegionRef.current = true;
    setNational(false);
    setWardCode(code);
    setGpsCoords(null);
    setGpsStatus("idle");
    setListUpdatedNotice(false);
    if (userId && provinceCode) {
      saveRegionMutation.mutate({ searchProvinceCode: provinceCode, searchWardCode: code });
    }
  };

  const handleRequestGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("unsupported");
      return;
    }
    userChangedRegionRef.current = true;
    setGpsStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const rounded = normalizeVnCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (!rounded) {
          toast.error("Tọa độ hiện tại nằm ngoài phạm vi hỗ trợ tại Việt Nam");
          setGpsStatus("idle");
          return;
        }
        setGpsCoords(rounded);
        setGpsStatus("granted");
        setNational(false);
        setListUpdatedNotice(false);
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const handleClearGps = () => {
    setGpsCoords(null);
    setGpsStatus("idle");
    if (!provinceCode) setNational(true);
  };

  const handleExpandRadius = () => {
    const next = nextRadiusStep(radiusKm);
    if (next) setRadiusKm(next);
  };

  const toggleAmenity = (slug: string) => {
    setSelectedAmenities((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  const clearFilters = () => {
    setPriceMax(null);
    setSelectedAmenities([]);
    setSort("relevance");
  };

  const activeFilterCount = (priceMax != null ? 1 : 0) + selectedAmenities.length + (sort !== "relevance" ? 1 : 0);
  const expandToKm = effectiveScope === "near" ? nextRadiusStep(radiusKm) : null;

  return (
    <div className="p-4 md:p-6 pb-20 md:pb-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Dumbbell className="w-5 h-5 text-green-400" /> Tìm phòng gym
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Khám phá phòng gym phù hợp khu vực của bạn và chọn gói hội viên</p>
      </div>

      {/* Search & filter controls */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1 min-w-0">
          <Search className="w-4 h-4 text-zinc-500 shrink-0" />
          <input
            aria-label="Tìm phòng gym"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setDebouncedQ(searchInput.trim());
            }}
            placeholder="Tìm theo tên phòng gym, thương hiệu hoặc địa chỉ..."
            className="flex-1 min-w-0 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
          />
          {searchInput && (
            <button
              type="button"
              aria-label="Xóa từ khóa tìm phòng gym"
              onClick={() => {
                setSearchInput("");
                setDebouncedQ("");
              }}
              className="text-zinc-600 hover:text-zinc-400 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <select
            aria-label="Sắp xếp phòng gym"
            value={sort}
            onChange={(e) => setSort(e.target.value as GymSortBy)}
            className="flex-1 sm:flex-initial px-3 py-2.5 bg-zinc-900 border border-zinc-700/60 rounded-xl text-sm text-zinc-200 outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm transition-colors whitespace-nowrap shrink-0 ${
              activeFilterCount > 0
                ? "border-green-500/60 bg-green-500/10 text-green-400"
                : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Filter className="w-4 h-4" /> Lọc {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>
      </div>

      {/* Explicit region & opt-in GPS picker */}
      <SearchRegionBar
        scope={effectiveScope}
        national={national}
        provinceCode={provinceCode}
        wardCode={wardCode}
        radiusKm={radiusKm}
        provinces={provinces}
        wards={wards}
        gpsCoords={gpsCoords}
        gpsStatus={gpsStatus}
        savingRegion={saveRegionMutation.isPending}
        onSelectNational={handleSelectNational}
        onSelectProvince={handleSelectProvince}
        onSelectWard={handleSelectWard}
        onRequestGps={handleRequestGps}
        onClearGps={handleClearGps}
        onRadiusChange={(km) => {
          setRadiusKm(km);
          setListUpdatedNotice(false);
        }}
      />

      {/* Filter drawer panel */}
      {filterOpen && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <span className="text-sm font-bold text-zinc-100">Bộ lọc tìm kiếm</span>
            <button type="button" onClick={() => setFilterOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Đóng bộ lọc">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Mức giá tối đa</label>
            <div className="flex flex-wrap gap-2">
              {PRICE_MAX_OPTIONS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setPriceMax(priceMax === b.value ? null : b.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    priceMax === b.value ? "bg-green-500 text-black border-green-500" : "bg-zinc-800 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {knownAmenities.size > 0 && (
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Tiện ích</label>
              <div className="flex flex-wrap gap-2">
                {[...knownAmenities.values()].map((am) => {
                  const active = selectedAmenities.includes(am.slug);
                  return (
                    <button
                      key={am.slug}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleAmenity(am.slug)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        active
                          ? "bg-green-500 text-black border-green-500"
                          : "bg-zinc-800 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <AmenityIcon iconKey={am.iconKey} className="size-3.5 shrink-0" />
                      <span>{am.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={clearFilters}
              className="flex-1 py-2 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Xoá bộ lọc
            </button>
            <button
              type="button"
              onClick={() => setFilterOpen(false)}
              className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-colors"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}

      {listUpdatedNotice && (
        <div
          role="status"
          data-testid="list-updated-banner"
          className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300"
        >
          <span className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0" />
            Danh sách đã cập nhật — đã tải lại kết quả mới nhất.
          </span>
          <button type="button" onClick={() => setListUpdatedNotice(false)} className="text-amber-300/80 hover:text-amber-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Đang tải phòng gym">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 rounded-2xl border border-zinc-800/60 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && isError && gymsList.length === 0 && !isCursorResetError(error) && (
        <div className="bg-zinc-900 rounded-2xl border border-red-500/20 p-8 text-center space-y-2">
          <p className="text-sm text-red-400">Không tải được danh sách phòng gym. Vui lòng thử lại.</p>
          <button
            type="button"
            onClick={() => setCursorResetSeq((s) => s + 1)}
            className="px-4 py-2 rounded-lg border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            Thử lại
          </button>
        </div>
      )}

      {!isLoading && !isError && gymsList.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-8 sm:p-14 text-center space-y-4">
          <Dumbbell className="w-12 h-12 text-zinc-700 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-zinc-200 font-bold">
              {effectiveScope === "near"
                ? `Không tìm thấy phòng gym trong bán kính ${radiusKm} km`
                : "Không tìm thấy phòng gym phù hợp"}
            </h3>
            <p className="text-sm text-zinc-500">
              Thử mở rộng phạm vi khu vực hoặc bỏ bớt bộ lọc đang chọn.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {expandToKm && (
              <button
                type="button"
                data-testid="expand-radius-btn"
                onClick={handleExpandRadius}
                className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-black text-xs font-bold transition-colors"
              >
                Mở rộng bán kính lên {expandToKm} km
              </button>
            )}
            {!national && (
              <button
                type="button"
                onClick={handleSelectNational}
                className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-200 text-xs font-semibold hover:bg-zinc-800 transition-colors"
              >
                Tìm toàn quốc
              </button>
            )}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-xs font-semibold hover:bg-zinc-800 transition-colors"
              >
                Xoá bộ lọc
              </button>
            )}
          </div>
        </div>
      )}

      {!isLoading && gymsList.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start gap-4">
            {gymsList.map((gym) => {
              const badge = formatGymDistanceBadge({
                distanceKm: gym.distanceKm,
                appliedScope,
                hasGps: !!gpsCoords,
                selectedWardName,
              });
              return (
                <GymResultCard
                  key={gym.id}
                  gym={gym}
                  badgeText={badge.text}
                  badgeKind={badge.kind}
                  onSelect={() => setSelectedGymId(gym.id)}
                />
              );
            })}
          </div>

          {hasNextPage && (
            <button
              type="button"
              data-testid="gyms-load-more"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-zinc-700/60 bg-zinc-900 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors disabled:opacity-60"
            >
              {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />}
              {isFetchingNextPage ? "Đang tải thêm…" : "Xem thêm"}
            </button>
          )}
        </div>
      )}

      {selectedGymId && <GymDetailModal gymId={selectedGymId} onClose={() => setSelectedGymId(null)} />}
    </div>
  );
}
