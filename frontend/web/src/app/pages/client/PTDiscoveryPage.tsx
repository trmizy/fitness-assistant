import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  MagnifyingGlassIcon as Search,
  MedalIcon as Award,
  FunnelIcon as Filter,
  CheckIcon as Check,
  CircleNotchIcon as Loader2,
  UsersIcon as Users,
  ChatTextIcon as MessageSquare,
  ClockIcon as Clock,
  XIcon as X,
  GlobeIcon as Globe,
  MapPinIcon as MapPin,
  LinkedinLogoIcon as Linkedin,
  InstagramLogoIcon as Instagram,
} from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isSafeHttpUrl } from "../../utils/safeUrl";
import {
  profileService,
  chatService,
  contractService,
  locationService,
  ptServicePackageService,
  collaborationService,
} from "../../services/api";
import { toast } from "sonner";
import { formatVND } from "../../utils/currency";
import { QUICK_FILTERS } from "../../constants/specialties";
import { Stars } from "../../components/gym/Stars";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const isValidPrice = (p: unknown): p is number =>
  typeof p === "number" && p > 0;

const emptyFilters = {
  q: "",
  minPrice: "",
  maxPrice: "",
  sessionMode: "",
  provinceCode: "",
  wardCode: "",
};

function serviceModeLabel(mode?: string) {
  if (mode === "ONLINE") return "Online qua video call";
  if (mode === "OFFLINE") return "Offline tại phòng gym";
  if (mode === "HYBRID") return "Cả online và offline";
  return undefined;
}

function getLowestPerSessionPrice(app: any): number | null {
  const prices = [
    app?.onlinePricePerSession,
    app?.offlinePricePerSession,
    app?.desiredSessionPrice,
  ].filter(isValidPrice) as number[];
  return prices.length > 0 ? Math.min(...prices) : null;
}

function safeParseSocialLinks(raw: any): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, string>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

// Chips and their filter values are the same strings now — the two arrays used to be kept
// in step by hand, which is how "Strength" ended up in one and not the other.
const filters = ["Tất cả", ...QUICK_FILTERS];
const filterValues = ["All", ...QUICK_FILTERS];

export function PTDiscoveryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messagingPT, setMessagingPT] = useState(false);
  // Mirrors this page's own `lg` (1024px) breakpoint exactly (the list/detail layout
  // switches from flex-col to flex-row there) — deliberately not the shared useIsMobile
  // hook, which is pinned to 768px and would disagree with this page's own CSS between
  // 768–1024px. Drives whether the detail panel below renders inline (desktop) or as a
  // portaled bottom-sheet modal (mobile) — see its own comment for why a portal at all.
  const [isDesktopView, setIsDesktopView] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktopView(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Filter panel state
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState(emptyFilters);
  const [pendingFilters, setPendingFilters] = useState(emptyFilters);
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>(
    [],
  );
  const [wards, setWards] = useState<{ code: number; name: string }[]>([]);

  // Request coaching modal state
  const [showRequestModal, setShowRequestModal] = useState(false);
  useBackDismissible(!!showRequestModal, () => setShowRequestModal(false));
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  const [requestMessage, setRequestMessage] = useState("");
  // Which partner gym the sessions run at. "" means independent — the PT keeps the gym's
  // share. This choice sets the contract's revenue split, so it is asked explicitly rather
  // than guessed from the trainer's listed locations.
  const [selectedGymId, setSelectedGymId] = useState("");
  const [lowAvailabilityData, setLowAvailabilityData] = useState<{
    availableSlots: number;
    packageSessions: number;
    nearestAvailableSlot: { date: string; startTime: string } | null;
  } | null>(null);

  useEffect(() => {
    locationService
      .getProvinces()
      .then(setProvinces)
      .catch(() => {});
  }, []);

  const handleProvinceChange = async (code: string) => {
    setPendingFilters((prev) => ({
      ...prev,
      provinceCode: code,
      wardCode: "",
    }));
    if (code) {
      const ws = await locationService.getWards(Number(code)).catch(() => []);
      setWards(ws);
    } else {
      setWards([]);
    }
  };

  const applyFilters = () => {
    setActiveFilters(pendingFilters);
    setFilterOpen(false);
  };

  const clearFilters = () => {
    setPendingFilters(emptyFilters);
    setActiveFilters(emptyFilters);
    setWards([]);
  };

  const handleMessage = async (ptUserId: string) => {
    try {
      setMessagingPT(true);
      const data = await chatService.createDirectConversation(ptUserId);
      const conversationId = data?.id || data?.conversation?.id;
      if (conversationId) {
        navigate(`/client/chat?conversationId=${conversationId}`);
      } else {
        // 2xx but no id: previously this silently did nothing, leaving the button
        // looking broken with no clue why.
        toast.error("Máy chủ không trả về mã cuộc hội thoại");
      }
    } catch (err: any) {
      // Surface the real reason — a bare "không thể" gives nothing to act on, and on a
      // phone there is no console to check. Covers all three failure shapes: an HTTP
      // error from the server, a transport failure (offline/timeout/wrong server
      // address), and anything else.
      const status = err?.response?.status;
      const serverMsg =
        err?.response?.data?.error?.message ??
        err?.response?.data?.error ??
        err?.response?.data?.message;
      toast.error(
        status
          ? `Không thể bắt đầu cuộc hội thoại (${status}${serverMsg ? `: ${serverMsg}` : ""})`
          : `Không thể kết nối máy chủ: ${err?.message ?? "lỗi không rõ"}`,
      );
    } finally {
      setMessagingPT(false);
    }
  };

  const requestMutation = useMutation({
    mutationFn: (data: any) => contractService.requestContract(data),
    onSuccess: () => {
      toast.success(
        "Yêu cầu huấn luyện đã được gửi! Huấn luyện viên sẽ xem xét yêu cầu của bạn.",
      );
      setShowRequestModal(false);
      setRequestMessage("");
      setSelectedPackage(null);
      setSelectedGymId("");
      setLowAvailabilityData(null);
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      if (
        err?.response?.status === 409 &&
        err?.response?.data?.code === "LOW_AVAILABILITY"
      ) {
        setLowAvailabilityData({
          availableSlots: err.response.data.availableSlots,
          packageSessions: err.response.data.packageSessions,
          nearestAvailableSlot: err.response.data.nearestAvailableSlot ?? null,
        });
      } else {
        toast.error(err?.response?.data?.error || "Không thể gửi yêu cầu");
      }
    },
  });

  const handleRequestCoaching = (pkg: any) => {
    setSelectedPackage(pkg);
    setLowAvailabilityData(null);
    setShowRequestModal(true);
  };

  const submitRequest = (acknowledgedLowAvailability = false) => {
    if (!selectedPT || !selectedPackage) return;
    
    // Only an offline package can run at a gym; an online one never carries a gym share.
    const gymId =
      selectedPackage.sessionMode === "OFFLINE" && selectedGymId ? selectedGymId : undefined;

    requestMutation.mutate({
      ptUserId: selectedPT.userId,
      packageId: selectedPackage.id,
      clientMessage: requestMessage || undefined,
      gymId,
      acknowledgedLowAvailability,
    });
  };

  /**
   * Gyms this trainer has an ACCEPTED partnership with. Only these may be picked: the split
   * has to come from terms both sides agreed to, and the server refuses a gymId with no
   * accepted collaboration rather than quietly falling back to the independent rate.
   */
  const { data: partnerGyms = [] } = useQuery<any[]>({
    queryKey: ["pt-partner-gyms", selectedId],
    queryFn: () => collaborationService.listGymsForPt(selectedId!),
    enabled: !!selectedId && showRequestModal,
  });

  const { data: packagesData, isLoading: packagesLoading } = useQuery({
    queryKey: ["pt-packages", selectedId],
    queryFn: () => ptServicePackageService.getPackagesForPT(selectedId!),
    enabled: !!selectedId,
  });

  const { data: ptsData, isLoading } = useQuery({

    queryKey: ["pts-list", activeFilters],
    queryFn: () =>
      profileService.listPTs({
        q: activeFilters.q || undefined,
        minPrice: activeFilters.minPrice
          ? Number(activeFilters.minPrice)
          : undefined,
        maxPrice: activeFilters.maxPrice
          ? Number(activeFilters.maxPrice)
          : undefined,
        sessionMode: activeFilters.sessionMode || undefined,
        provinceCode: activeFilters.provinceCode
          ? Number(activeFilters.provinceCode)
          : undefined,
        wardCode: activeFilters.wardCode
          ? Number(activeFilters.wardCode)
          : undefined,
      }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const ptsList = ptsData?.pts || [];

  const filtered = ptsList.filter((pt: any) => {
    const specialties: string[] = pt.ptApplication?.mainSpecialties || [];
    const filterValue =
      filterValues[filters.indexOf(activeFilter)] ?? activeFilter;
    return (
      filterValue === "All" ||
      specialties.some((s: string) =>
        s.toLowerCase().includes(filterValue.toLowerCase()),
      )
    );
  });

  const selectedPT = ptsList.find((pt: any) => pt.userId === selectedId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2">
          <Search className="w-5 h-5 text-green-400" /> Tìm PT
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Khám phá các huấn luyện viên cá nhân được chứng nhận và bắt đầu hành
          trình huấn luyện của bạn
        </p>
      </div>

      {/* Search & filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            value={pendingFilters.q}
            onChange={(e) =>
              setPendingFilters((prev) => ({ ...prev, q: e.target.value }))
            }
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="Tìm theo tên hoặc chuyên môn…"
            className="flex-1 text-sm outline-none text-zinc-300 placeholder-zinc-600 bg-transparent"
          />
          {pendingFilters.q && (
            <button
              onClick={() => {
                setPendingFilters((prev) => ({ ...prev, q: "" }));
                setActiveFilters((prev) => ({ ...prev, q: "" }));
              }}
              className="text-zinc-600 hover:text-zinc-400"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => {
            setPendingFilters(activeFilters);
            setFilterOpen(true);
          }}
          className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm transition-colors ${Object.values(activeFilters).some((v) => v && v !== activeFilters.q) ? "border-green-500/60 bg-green-500/10 text-green-400" : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
        >
          <Filter className="w-4 h-4" /> Lọc
        </button>
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.37)] rounded-xl p-4 space-y-4 transition-all">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-sm font-bold text-zinc-100 tracking-tight">Bộ lọc tìm kiếm</span>
            <button
              onClick={() => setFilterOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                Hình thức
              </label>
              <select
                value={pendingFilters.sessionMode}
                onChange={(e) =>
                  setPendingFilters((prev) => ({
                    ...prev,
                    sessionMode: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
              >
                <option value="">Tất cả</option>
                <option value="ONLINE">Online</option>
                <option value="OFFLINE">Offline</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                Giá tối thiểu (VND)
              </label>
              <input
                type="number"
                min={0}
                placeholder="0"
                value={pendingFilters.minPrice}
                onChange={(e) =>
                  setPendingFilters((prev) => ({
                    ...prev,
                    minPrice: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                Giá tối đa (VND)
              </label>
              <input
                type="number"
                min={0}
                placeholder="Không giới hạn"
                value={pendingFilters.maxPrice}
                onChange={(e) =>
                  setPendingFilters((prev) => ({
                    ...prev,
                    maxPrice: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                Tỉnh/Thành phố
              </label>
              <select
                value={pendingFilters.provinceCode}
                onChange={(e) => handleProvinceChange(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
              >
                <option value="">Tất cả</option>
                {provinces.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {wards.length > 0 && (
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                  Phường/Xã
                </label>
                <select
                  value={pendingFilters.wardCode}
                  onChange={(e) =>
                    setPendingFilters((prev) => ({
                      ...prev,
                      wardCode: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                >
                  <option value="">Tất cả</option>
                  {wards.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-3 border-t border-white/10 mt-2">
            <button
              onClick={clearFilters}
              className="flex-1 py-2 border border-white/10 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-white/10 transition-colors"
            >
              Xóa bộ lọc
            </button>
            <button
              onClick={applyFilters}
              className="flex-1 py-2 bg-green-500 hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] text-black text-sm font-bold rounded-lg transition-all"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map((f, i) => (
          <button
            key={f}
            onClick={() => setActiveFilter(filterValues[i])}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${activeFilter === filterValues[i] ? "bg-green-500 text-black border-green-500 shadow-lg shadow-green-500/20" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40 hover:text-zinc-200"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* PT cards */}
        <div
          className={`space-y-3 ${selectedId ? "lg:w-96 flex-shrink-0" : "flex-1"}`}
        >
          {filtered.length > 0 ? (
            filtered.map((pt: any) => {
              const lowestPrice = getLowestPerSessionPrice(pt.ptApplication);
              const primaryLoc =
                pt.trainingLocations?.find((l: any) => l.isPrimary) ??
                pt.trainingLocations?.[0];
              const otherLocCount = Math.max(
                0,
                (pt.trainingLocations?.length ?? 0) - 1,
              );
              const locationText = primaryLoc
                ? [
                    primaryLoc.gymName,
                    primaryLoc.ward?.name,
                    primaryLoc.province?.name,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : pt.ptApplication?.serviceMode === "ONLINE"
                  ? "Coaching online"
                  : undefined;
              return (
                <button
                  key={pt.userId}
                  onClick={() =>
                    setSelectedId(selectedId === pt.userId ? null : pt.userId)
                  }
                  className={`w-full text-left bg-zinc-900 rounded-xl border-2 p-4 transition-all ${selectedId === pt.userId ? "border-green-500 bg-green-500/5" : "border-zinc-800/60 hover:border-zinc-700"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0">
                      {pt.firstName?.[0]}
                      {pt.lastName?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-zinc-200">
                              {pt.firstName} {pt.lastName}
                            </span>
                            <Award className="w-3.5 h-3.5 text-green-400" />
                          </div>
                          {/* A PT with no reviews shows "Chưa có đánh giá", never 0 stars —
                              an unrated trainer is unknown, not badly rated. */}
                          <div className="flex items-center gap-1.5 text-xs mt-1">
                            {pt.avgRating != null ? (
                              <>
                                <Stars value={pt.avgRating} size={13} />
                                <span className="text-zinc-400 font-medium">
                                  {pt.avgRating.toFixed(1)}
                                </span>
                                <span className="text-zinc-600">
                                  ({pt.ratingCount})
                                </span>
                              </>
                            ) : (
                              <span className="text-zinc-600">Chưa có đánh giá</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-zinc-600 mt-0.5">
                            {locationText && (
                              <>
                                <MapPin className="w-3 h-3" />
                                {locationText}
                                {otherLocCount > 0 &&
                                  ` +${otherLocCount} địa điểm khác`}
                              </>
                            )}
                            {pt.ptApplication?.yearsOfExperience
                              ? ` · ${pt.ptApplication.yearsOfExperience} kinh nghiệm`
                              : ""}
                          </div>
                        </div>
                        {lowestPrice && (
                          <span className="text-xs font-bold text-green-400 whitespace-nowrap">
                            từ {formatVND(lowestPrice)}
                          </span>
                        )}
                      </div>
                      {pt.ptApplication?.mainSpecialties?.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {pt.ptApplication.mainSpecialties
                            .slice(0, 3)
                            .map((s: string) => (
                              <span
                                key={s}
                                className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-400"
                              >
                                {s}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-20 text-center bg-zinc-900/50 rounded-2xl border border-zinc-800/60">
              <Users className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500">
                Không tìm thấy PT phù hợp với bộ lọc hiện tại.
              </p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedPT &&
          (() => {
            const app = selectedPT.ptApplication;
            const ptMode = app?.serviceMode;
            const spk = app?.sessionsPerPackage || 10;
            const certs =
              app?.certificates?.filter((c: any) => c.isCurrentlyValid) || [];
            const socialLinks = safeParseSocialLinks(app?.socialLinks);


            // The page's own route content sits inside AppShell's animated
            // <motion.div> (Framer Motion applies a `transform` there for the page-switch
            // slide/fade — see AppShell.tsx). ANY transform on an ancestor gives
            // `position: fixed` descendants a new containing block, so a plain `fixed
            // inset-0` here would size itself against that div's own content box instead
            // of the real viewport — exactly the "modal pinned near the top, with a dead
            // gap before the bottom nav" bug just reported. A portal to document.body is
            // the standard fix (same pattern already used by
            // PlanMarketplacePage's modal): it renders the sheet as a sibling of the
            // animated tree entirely, so `fixed` finally means the actual screen. Desktop
            // is a completely different, non-portaled render (the plain inline panel this
            // always was) — the two are simple enough to keep as separate branches rather
            // than forcing one wrapper to serve both.
            const content = (
              <>
                {/* Header */}
                <div className="p-5 border-b border-zinc-800/60">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-xl flex-shrink-0">
                      {selectedPT.firstName?.[0]}
                      {selectedPT.lastName?.[0]}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-zinc-100">
                            {selectedPT.firstName} {selectedPT.lastName}
                          </h2>
                          <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20">
                            <Award className="w-3 h-3" /> Đã xác minh
                          </span>
                          {selectedPT.avgRating != null ? (
                            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                              <Stars value={selectedPT.avgRating} size={13} />
                              {selectedPT.avgRating.toFixed(1)}
                              <span className="text-zinc-600">
                                ({selectedPT.ratingCount} đánh giá)
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-600">
                              Chưa có đánh giá
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedId(null)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors flex-shrink-0"
                          aria-label="Đóng"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1 flex-wrap">
                        {(() => {
                          const pLoc =
                            selectedPT.trainingLocations?.find(
                              (l: any) => l.isPrimary,
                            ) ?? selectedPT.trainingLocations?.[0];
                          const locStr = pLoc
                            ? [
                                pLoc.gymName,
                                pLoc.ward?.name,
                                pLoc.province?.name,
                              ]
                                .filter(Boolean)
                                .join(", ")
                            : ptMode === "ONLINE"
                              ? "Coaching online"
                              : undefined;
                          return locStr ? (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {locStr}
                            </span>
                          ) : null;
                        })()}
                        {app?.yearsOfExperience && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />{" "}
                            {app.yearsOfExperience} kinh nghiệm
                          </span>
                        )}
                        {serviceModeLabel(ptMode) && (
                          <span className="text-blue-400">
                            {serviceModeLabel(ptMode)}
                          </span>
                        )}
                      </div>
                      {app?.mainSpecialties?.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {app.mainSpecialties.map((s: string) => (
                            <span
                              key={s}
                              className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-400"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
                    {app?.professionalBio ||
                      "Huấn luyện thể hình chuyên nghiệp. Kết nối với huấn luyện viên này để bắt đầu hành trình cá nhân hóa của bạn."}
                  </p>

                  {/* Certifications */}
                  {certs.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {certs.map((c: any) => (
                        <span
                          key={c.certificateName}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 bg-green-500/5 border border-green-500/15 rounded-lg text-green-400"
                        >
                          <Award className="w-3 h-3" /> {c.certificateName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-5 space-y-5">
                  {/* Education & Work Experience */}
                  {(app?.educationBackground ||
                    app?.previousWorkExperience) && (
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                        Kinh nghiệm & Học vấn
                      </h4>
                      <div className="space-y-2 text-sm text-zinc-400 leading-relaxed">
                        {app.educationBackground && (
                          <p>
                            <span className="text-zinc-500 text-xs">
                              Học vấn:{" "}
                            </span>
                            {app.educationBackground}
                          </p>
                        )}
                        {app.previousWorkExperience && (
                          <p>
                            <span className="text-zinc-500 text-xs">
                              Kinh nghiệm:{" "}
                            </span>
                            {app.previousWorkExperience}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Training Methods */}
                  {app?.trainingMethodsApproach && (
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                        Phương pháp huấn luyện
                      </h4>
                      <p className="text-sm text-zinc-400 leading-relaxed">
                        {app.trainingMethodsApproach}
                      </p>
                    </div>
                  )}

                  {/* Target groups & Goals */}
                  {((app?.targetClientGroups?.length ?? 0) > 0 ||
                    (app?.primaryTrainingGoals?.length ?? 0) > 0) && (
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                        Đối tượng & Mục tiêu
                      </h4>
                      {app.targetClientGroups?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {app.targetClientGroups.map((g: string) => (
                            <span
                              key={g}
                              className="text-[10px] px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                      {app.primaryTrainingGoals?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {app.primaryTrainingGoals.map((g: string) => (
                            <span
                              key={g}
                              className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-400"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Availability schedule */}
                  {app?.availableDays?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                        Lịch làm việc
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {app.availableDays.map((d: string) => (
                          <span
                            key={d}
                            className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-300 font-medium"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                      {(app.availableFrom || app.availableUntil) && (
                        <p className="text-xs text-zinc-500 mt-1">
                          {app.availableFrom && `Từ ${app.availableFrom}`}
                          {app.availableFrom && app.availableUntil && " - "}
                          {app.availableUntil && `đến ${app.availableUntil}`}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Gym affiliation */}
                  {app?.gymAffiliation && (
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                        Phòng gym
                      </h4>
                      <p className="text-sm text-zinc-300">
                        {app.gymAffiliation}
                      </p>
                    </div>
                  )}

                  {/* Social links */}
                  {(app?.linkedinUrl ||
                    app?.websiteUrl ||
                    socialLinks.instagram ||
                    socialLinks.youtube ||
                    socialLinks.tiktok ||
                    socialLinks.facebook) && (
                    <div>
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                        Links
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {app.linkedinUrl && isSafeHttpUrl(app.linkedinUrl) && (
                          <a
                            href={app.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 transition-colors"
                          >
                            <Linkedin className="w-3 h-3" /> LinkedIn
                          </a>
                        )}
                        {app.websiteUrl && isSafeHttpUrl(app.websiteUrl) && (
                          <a
                            href={app.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 bg-zinc-800 px-2 py-1 rounded-lg border border-zinc-700/60 transition-colors"
                          >
                            <Globe className="w-3 h-3" /> Website
                          </a>
                        )}
                        {socialLinks.instagram && (
                          <span className="flex items-center gap-1.5 text-xs text-pink-400 bg-pink-500/10 px-2 py-1 rounded-lg border border-pink-500/20">
                            <Instagram className="w-3 h-3" />{" "}
                            {socialLinks.instagram}
                          </span>
                        )}
                        {socialLinks.youtube && (
                          <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/20">
                            YT {socialLinks.youtube}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pricing */}
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200 mb-3">
                      Bảng giá
                    </h4>
                    <div className="space-y-3">
                      {packagesLoading ? (
                        <div className="flex justify-center p-4">
                          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
                        </div>
                      ) : packagesData?.length > 0 ? (
                        packagesData.map((pkg: any) => {
                          const isPerSession = pkg.sessionCount === 1;
                          return (
                            <div
                              key={pkg.id}
                              className={`border rounded-xl p-4 transition-all ${
                                isPerSession
                                  ? "border-green-500/50 bg-green-500/5"
                                  : "border-zinc-700/60"
                              }`}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-zinc-200">
                                      {pkg.name}
                                    </span>
                                    {isPerSession && (
                                      <span className="text-xs bg-green-500 text-black px-2 py-0.5 rounded-full font-bold">
                                        Phổ biến
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {isPerSession
                                      ? "Theo buổi"
                                      : `${pkg.sessionCount} buổi · ${formatVND(
                                          Number(pkg.price) / pkg.sessionCount,
                                        )}/buổi`}
                                    {" · "}
                                    {pkg.sessionMode === "ONLINE"
                                      ? "Online"
                                      : "Offline"}
                                  </div>
                                </div>
                                <span className="text-base font-bold text-green-400">
                                  {formatVND(Number(pkg.price))}
                                </span>
                              </div>
                              <ul className="space-y-1 mb-3 mt-2">
                                <li className="flex items-center gap-1.5 text-xs text-zinc-400">
                                  <Check className="w-3.5 h-3.5 text-green-500" />{" "}
                                  Kế hoạch tập luyện từ AI cá nhân hóa
                                </li>
                                <li className="flex items-center gap-1.5 text-xs text-zinc-400">
                                  <Check className="w-3.5 h-3.5 text-green-500" />{" "}
                                  Hỗ trợ chat trực tiếp
                                </li>
                                {pkg.description && (
                                  <li className="flex items-center gap-1.5 text-xs text-zinc-400 mt-2 italic">
                                    {pkg.description}
                                  </li>
                                )}
                              </ul>
                              <button
                                onClick={() => handleRequestCoaching(pkg)}
                                className={`w-full py-2.5 text-sm font-bold rounded-lg transition-all ${
                                  isPerSession
                                    ? "bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/20"
                                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60"
                                }`}
                              >
                                Yêu cầu huấn luyện
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="border rounded-xl p-4 border-zinc-700/60 text-center">
                          <p className="text-sm text-zinc-500">
                            Liên hệ huấn luyện viên để biết chi tiết giá.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Message button */}
                    <button
                      onClick={() => handleMessage(selectedPT.userId)}
                      disabled={messagingPT}
                      className="w-full py-2.5 mt-3 border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {messagingPT ? "Đang mở chat…" : "Nhắn tin"}
                    </button>
                  </div>
                </div>
              </>
            );

            if (isDesktopView) {
              return (
                <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden self-start">
                  {content}
                </div>
              );
            }

            return createPortal(
              <div
                className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end justify-center"
                onClick={() => setSelectedId(null)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-zinc-800/60 bg-zinc-900"
                >
                  {content}
                </div>
              </div>,
              document.body,
            );
          })()}
      </div>

      {/* Request Coaching Modal — portaled to <body> and above the mobile detail sheet's
          z-[60] (see the PT-detail bottom sheet above). Without the portal, this fixed
          overlay's containing block becomes AppShell's animated page-transition wrapper
          (it applies a `transform`, which per spec creates a new containing block for any
          `position: fixed` descendant) instead of the real viewport — same class of bug as
          the PT-detail panel fix, just left unfixed here originally. */}
      {showRequestModal && selectedPT && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Yêu cầu huấn luyện</h3>
              <button
                onClick={() => setShowRequestModal(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 bg-zinc-800/50 rounded-xl p-3">
                <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-sm">
                  {selectedPT.firstName?.[0]}
                  {selectedPT.lastName?.[0]}
                </div>
                <div>
                  <div className="text-sm font-bold text-zinc-200">
                    {selectedPT.firstName} {selectedPT.lastName}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {/* `requestType` was referenced here with no declaration anywhere in this
                        component — an orphaned leftover that threw "requestType is not defined"
                        and crashed this modal outright the instant it opened, for every package.
                        Real bug found live while testing the PT-hiring flow. Fixed to match the
                        same isPerSession check (`sessionCount === 1`) used elsewhere in this file. */}
                    {selectedPackage?.sessionCount === 1
                      ? "Theo buổi"
                      : "Gói dịch vụ"}
                    {" · "}
                    {selectedPackage?.sessionMode === "ONLINE" ? "Online" : "Offline"}
                  </div>
                </div>
              </div>

              {lowAvailabilityData && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-500">
                  <h4 className="font-bold text-sm mb-1">
                    Cảnh báo lịch trống
                  </h4>
                  <p className="text-xs mb-3">
                    Lịch của huấn luyện viên hiện tại có khá ít slot trống (
                    {lowAvailabilityData.availableSlots} slot) so với số buổi
                    của gói tập ({lowAvailabilityData.packageSessions} buổi).
                    Bạn có chắc chắn muốn mua gói này?
                  </p>
                  {lowAvailabilityData.nearestAvailableSlot ? (
                    <p className="text-xs mb-3">
                      Lịch trống gần nhất:{" "}
                      <span className="font-semibold">
                        {/* Built from the "YYYY-MM-DD"+"HH:MM" pair as local wall-clock values
                            (not parsed as a UTC instant) — the same reasoning as
                            localDateKey() server-side: this date already IS the local day the
                            slot falls on, so re-interpreting it through a UTC-then-shift-back
                            round trip risks landing on the wrong day for the reader. */}
                        {(() => {
                          const [y, m, d] = lowAvailabilityData.nearestAvailableSlot.date
                            .split("-")
                            .map(Number);
                          return new Date(y, m - 1, d).toLocaleDateString("vi-VN", {
                            weekday: "long",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          });
                        })()}{" "}
                        lúc {lowAvailabilityData.nearestAvailableSlot.startTime}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs mb-3">
                      Không tìm thấy lịch trống nào trong 60 ngày tới.
                    </p>
                  )}
                  <button
                    onClick={() => submitRequest(true)}
                    disabled={requestMutation.isPending}
                    className="w-full py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-xs font-bold rounded-lg transition-all"
                  >
                    {requestMutation.isPending ? "Đang gửi…" : "Vẫn tiếp tục mua"}
                  </button>
                </div>
              )}

              {!lowAvailabilityData && (
                <div className="space-y-1 bg-zinc-800/50 rounded-lg px-3 py-3 border border-zinc-700/40">
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Tổng buổi tập</span>
                    <span className="font-semibold text-zinc-300">
                      {selectedPackage?.sessionCount} buổi
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-1 border-t border-zinc-700/30 mt-1">
                    <span className="text-zinc-400 font-medium">
                      Dự kiến tổng
                    </span>
                    <span className="font-bold text-green-400">
                      {formatVND(Number(selectedPackage?.price || 0))}
                    </span>
                  </div>
                </div>
              )}

              {selectedPackage?.sessionMode === "OFFLINE" && (
                <div>
                  <label
                    htmlFor="contract-gym"
                    className="text-xs font-semibold text-zinc-400 mb-1.5 block"
                  >
                    Tập tại phòng gym nào?
                  </label>
                  <select
                    id="contract-gym"
                    value={selectedGymId}
                    onChange={(e) => setSelectedGymId(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  >
                    <option value="">Không qua phòng gym</option>
                    {partnerGyms.map((g: any) => (
                      <option key={g.gym.id} value={g.gym.id}>
                        {g.gym.name}
                        {g.gym.city ? ` — ${g.gym.city}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-zinc-600 mt-1.5 leading-snug">
                    {selectedGymId
                      ? (() => {
                          const g = partnerGyms.find((x: any) => x.gym.id === selectedGymId);
                          return g
                            ? `Chia doanh thu: PT ${Math.round(Number(g.ptRate) * 100)}% · phòng gym ${Math.round(Number(g.gymRate) * 100)}% · nền tảng ${Math.round(Number(g.platformRate) * 100)}%.`
                            : "";
                        })()
                      : partnerGyms.length > 0
                        ? "Chọn phòng gym nếu bạn tập tại đó — phòng gym sẽ được chia một phần doanh thu."
                        : "Huấn luyện viên này chưa hợp tác với phòng gym nào."}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">
                  Gửi lời nhắn cho huấn luyện viên (không bắt buộc)
                </label>
                <textarea
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  rows={2}
                  placeholder="Chia sẻ mục tiêu, lịch rảnh của bạn với huấn luyện viên..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => setShowRequestModal(false)}
                className="flex-1 py-3 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              {!lowAvailabilityData && (
                <button
                  onClick={() => submitRequest()}
                  disabled={requestMutation.isPending}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
                >
                  {requestMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  {requestMutation.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
