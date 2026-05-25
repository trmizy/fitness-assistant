import { useState } from "react";
import { useNavigate } from "react-router";
import { Search, Award, Filter, Check, Loader2, Users, MessageSquare, Clock, X, Globe, MapPin, Linkedin, Instagram } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { profileService, chatService, contractService } from "../../services/api";
import { toast } from "sonner";

function formatPrice(price?: number | null) {
  if (!price) return null;
  return `฿${price.toLocaleString()}`;
}

const isValidPrice = (p: unknown): p is number => typeof p === 'number' && p > 0;

function serviceModeLabel(mode?: string) {
  if (mode === 'ONLINE') return 'Online qua video call';
  if (mode === 'OFFLINE') return 'Offline tại phòng gym';
  if (mode === 'HYBRID') return 'Cả online và offline';
  return undefined;
}

function getLowestPerSessionPrice(app: any): number | null {
  const prices = [app?.onlinePricePerSession, app?.offlinePricePerSession, app?.desiredSessionPrice].filter(isValidPrice) as number[];
  return prices.length > 0 ? Math.min(...prices) : null;
}

function safeParseSocialLinks(raw: any): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

const filters = ["Tất cả", "Fat Loss", "Muscle Gain", "Strength", "Yoga", "HIIT", "Powerlifting"];
const filterValues = ["All", "Fat Loss", "Muscle Gain", "Strength", "Yoga", "HIIT", "Powerlifting"];

export function PTDiscoveryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messagingPT, setMessagingPT] = useState(false);

  // Request coaching modal state
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestType, setRequestType] = useState<"PER_SESSION" | "PACKAGE">("PER_SESSION");
  const [selectedSessionMode, setSelectedSessionMode] = useState<'ONLINE' | 'OFFLINE' | null>(null);
  const [requestSessions, setRequestSessions] = useState(1);
  const [packageQuantity, setPackageQuantity] = useState(1);
  const [extraSessions, setExtraSessions] = useState(0);
  const [requestMessage, setRequestMessage] = useState("");

  const handleMessage = async (ptUserId: string) => {
    try {
      setMessagingPT(true);
      const data = await chatService.createDirectConversation(ptUserId);
      const conversationId = data?.id || data?.conversation?.id;
      if (conversationId) navigate(`/client/chat`);
    } catch {
      toast.error("Không thể bắt đầu cuộc hội thoại");
    } finally {
      setMessagingPT(false);
    }
  };

  const requestMutation = useMutation({
    mutationFn: (data: any) => contractService.requestContract(data),
    onSuccess: () => {
      toast.success("Yêu cầu huấn luyện đã được gửi! Huấn luyện viên sẽ xem xét yêu cầu của bạn.");
      setShowRequestModal(false);
      setRequestMessage("");
      setRequestSessions(1);
      setPackageQuantity(1);
      setExtraSessions(0);
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Không thể gửi yêu cầu");
    },
  });

  const handleRequestCoaching = (type: "PER_SESSION" | "PACKAGE", mode: 'ONLINE' | 'OFFLINE' | null) => {
    setRequestType(type);
    setSelectedSessionMode(mode);
    if (type === "PER_SESSION") setRequestSessions(1);
    else { setPackageQuantity(1); setExtraSessions(0); }
    setShowRequestModal(true);
  };

  const submitRequest = () => {
    if (!selectedPT) return;
    requestMutation.mutate({
      ptUserId: selectedPT.userId,
      packageType: requestType,
      packageName: requestType === "PER_SESSION" ? "Per Session" : "Coaching Package",
      packageQuantity: requestType === "PACKAGE" ? packageQuantity : 1,
      extraSessions: requestType === "PACKAGE" ? extraSessions : 0,
      totalSessions: requestType === "PER_SESSION" ? requestSessions : 0,
      message: requestMessage || undefined,
      sessionMode: selectedSessionMode ?? undefined,
    });
  };

  const { data: ptsData, isLoading } = useQuery({
    queryKey: ["pts-list"],
    queryFn: profileService.listPTs,
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
    const fullName = `${pt.firstName ?? ""} ${pt.lastName ?? ""}`.toLowerCase();
    const specialties: string[] = pt.ptApplication?.mainSpecialties || [];
    const matchesSearch = !search ||
      fullName.includes(search.toLowerCase()) ||
      specialties.some((s: string) => s.toLowerCase().includes(search.toLowerCase()));
    const filterValue = filterValues[filters.indexOf(activeFilter)] ?? activeFilter;
    const matchesFilter = filterValue === "All" ||
      specialties.some((s: string) => s.toLowerCase().includes(filterValue.toLowerCase()));
    return matchesSearch && matchesFilter;
  });

  const selectedPT = ptsList.find((pt: any) => pt.userId === selectedId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2"><Search className="w-5 h-5 text-green-400" /> Tìm PT</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Khám phá các huấn luyện viên cá nhân được chứng nhận và bắt đầu hành trình huấn luyện của bạn</p>
      </div>

      {/* Search & filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm theo tên hoặc chuyên môn…" className="flex-1 text-sm outline-none text-zinc-300 placeholder-zinc-600 bg-transparent" />
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
          <Filter className="w-4 h-4" /> Lọc
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map((f, i) => (
          <button key={f} onClick={() => setActiveFilter(filterValues[i])} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${activeFilter === filterValues[i] ? "bg-green-500 text-black border-green-500 shadow-lg shadow-green-500/20" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40 hover:text-zinc-200"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* PT cards */}
        <div className={`space-y-3 ${selectedId ? "lg:w-96 flex-shrink-0" : "flex-1"}`}>
          {filtered.length > 0 ? filtered.map((pt: any) => {
            const lowestPrice = getLowestPerSessionPrice(pt.ptApplication);
            return (
              <button
                key={pt.userId}
                onClick={() => setSelectedId(selectedId === pt.userId ? null : pt.userId)}
                className={`w-full text-left bg-zinc-900 rounded-xl border-2 p-4 transition-all ${selectedId === pt.userId ? "border-green-500 bg-green-500/5" : "border-zinc-800/60 hover:border-zinc-700"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0">
                    {pt.firstName?.[0]}{pt.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-200">{pt.firstName} {pt.lastName}</span>
                          <Award className="w-3.5 h-3.5 text-green-400" />
                        </div>
                        <div className="flex items-center gap-1 text-xs text-zinc-600 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {pt.ptApplication?.operatingAreas?.[0] || "Bangkok"}
                          {pt.ptApplication?.yearsOfExperience ? ` · ${pt.ptApplication.yearsOfExperience} kinh nghiệm` : " · Chứng nhận"}
                        </div>
                      </div>
                      {lowestPrice && (
                        <span className="text-xs font-bold text-green-400 whitespace-nowrap">
                          từ {formatPrice(lowestPrice)}
                        </span>
                      )}
                    </div>
                    {pt.ptApplication?.mainSpecialties?.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {pt.ptApplication.mainSpecialties.slice(0, 3).map((s: string) => (
                          <span key={s} className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-400">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          }) : (
            <div className="py-20 text-center bg-zinc-900/50 rounded-2xl border border-zinc-800/60">
              <Users className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500">Không tìm thấy huấn luyện viên phù hợp.</p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedPT && (() => {
          const app = selectedPT.ptApplication;
          const ptMode = app?.serviceMode;
          const spk = app?.sessionsPerPackage || 10;
          const certs = app?.certificates?.filter((c: any) => c.isCurrentlyValid) || [];
          const socialLinks = safeParseSocialLinks(app?.socialLinks);

          // Per-session pricing options
          const perSessionOptions: { label: string; price: number; mode: 'ONLINE' | 'OFFLINE' | null }[] = [];
          if ((ptMode === 'ONLINE' || ptMode === 'HYBRID') && isValidPrice(app?.onlinePricePerSession))
            perSessionOptions.push({ label: 'Online qua video call', price: app.onlinePricePerSession, mode: 'ONLINE' });
          if ((ptMode === 'OFFLINE' || ptMode === 'HYBRID') && isValidPrice(app?.offlinePricePerSession))
            perSessionOptions.push({ label: 'Offline tại phòng gym', price: app.offlinePricePerSession, mode: 'OFFLINE' });
          if (!isValidPrice(app?.onlinePricePerSession) && !isValidPrice(app?.offlinePricePerSession) && isValidPrice(app?.desiredSessionPrice)) {
            if (ptMode === 'HYBRID') {
              perSessionOptions.push(
                { label: 'Online qua video call', price: app.desiredSessionPrice, mode: 'ONLINE' },
                { label: 'Offline tại phòng gym', price: app.desiredSessionPrice, mode: 'OFFLINE' },
              );
            } else {
              const inferredMode: 'ONLINE' | 'OFFLINE' | null = ptMode === 'ONLINE' ? 'ONLINE' : ptMode === 'OFFLINE' ? 'OFFLINE' : null;
              perSessionOptions.push({ label: 'Theo buổi', price: app.desiredSessionPrice, mode: inferredMode });
            }
          }

          // Package pricing options
          const packageOptions: { label: string; price: number; pricePerSess: number; mode: 'ONLINE' | 'OFFLINE' | null }[] = [];
          if ((ptMode === 'ONLINE' || ptMode === 'HYBRID') && isValidPrice(app?.onlinePackagePrice))
            packageOptions.push({ label: `Online Gói (${spk} buổi)`, price: app.onlinePackagePrice, pricePerSess: app.onlinePackagePrice / spk, mode: 'ONLINE' });
          if ((ptMode === 'OFFLINE' || ptMode === 'HYBRID') && isValidPrice(app?.offlinePackagePrice))
            packageOptions.push({ label: `Offline Gói (${spk} buổi)`, price: app.offlinePackagePrice, pricePerSess: app.offlinePackagePrice / spk, mode: 'OFFLINE' });
          if (!isValidPrice(app?.onlinePackagePrice) && !isValidPrice(app?.offlinePackagePrice) && isValidPrice(app?.packagePrice)) {
            if (ptMode === 'HYBRID') {
              packageOptions.push(
                { label: `Online Gói (${spk} buổi)`, price: app.packagePrice, pricePerSess: app.packagePrice / spk, mode: 'ONLINE' },
                { label: `Offline Gói (${spk} buổi)`, price: app.packagePrice, pricePerSess: app.packagePrice / spk, mode: 'OFFLINE' },
              );
            } else {
              const inferredMode: 'ONLINE' | 'OFFLINE' | null = ptMode === 'ONLINE' ? 'ONLINE' : ptMode === 'OFFLINE' ? 'OFFLINE' : null;
              packageOptions.push({ label: `Gói (${spk} buổi)`, price: app.packagePrice, pricePerSess: app.packagePrice / spk, mode: inferredMode });
            }
          }

          const lowestPerSess = perSessionOptions.length > 0 ? Math.min(...perSessionOptions.map(o => o.price)) : null;
          const bestPkgRate = packageOptions.length > 0 ? Math.min(...packageOptions.map(o => o.pricePerSess)) : null;

          return (
            <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden self-start">
              {/* Header */}
              <div className="p-5 border-b border-zinc-800/60">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-xl flex-shrink-0">
                    {selectedPT.firstName?.[0]}{selectedPT.lastName?.[0]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-zinc-100">{selectedPT.firstName} {selectedPT.lastName}</h2>
                      <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20"><Award className="w-3 h-3" /> Đã xác minh</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1 flex-wrap">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {app?.operatingAreas?.[0] || "Bangkok"}</span>
                      {app?.yearsOfExperience && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {app.yearsOfExperience} kinh nghiệm</span>}
                      {serviceModeLabel(ptMode) && <span className="text-blue-400">{serviceModeLabel(ptMode)}</span>}
                    </div>
                    {app?.mainSpecialties?.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {app.mainSpecialties.map((s: string) => (
                          <span key={s} className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-400">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
                  {app?.professionalBio || "Huấn luyện thể hình chuyên nghiệp. Kết nối với huấn luyện viên này để bắt đầu hành trình cá nhân hóa của bạn."}
                </p>

                {/* Certifications */}
                {certs.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {certs.map((c: any) => (
                      <span key={c.certificateName} className="flex items-center gap-1 text-[10px] px-2 py-1 bg-green-500/5 border border-green-500/15 rounded-lg text-green-400">
                        <Award className="w-3 h-3" /> {c.certificateName}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-5 space-y-5">
                {/* Education & Work Experience */}
                {(app?.educationBackground || app?.previousWorkExperience) && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Kinh nghiệm & Học vấn</h4>
                    <div className="space-y-2 text-sm text-zinc-400 leading-relaxed">
                      {app.educationBackground && <p><span className="text-zinc-500 text-xs">Học vấn: </span>{app.educationBackground}</p>}
                      {app.previousWorkExperience && <p><span className="text-zinc-500 text-xs">Kinh nghiệm: </span>{app.previousWorkExperience}</p>}
                    </div>
                  </div>
                )}

                {/* Training Methods */}
                {app?.trainingMethodsApproach && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Phương pháp huấn luyện</h4>
                    <p className="text-sm text-zinc-400 leading-relaxed">{app.trainingMethodsApproach}</p>
                  </div>
                )}

                {/* Target groups & Goals */}
                {((app?.targetClientGroups?.length ?? 0) > 0 || (app?.primaryTrainingGoals?.length ?? 0) > 0) && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Đối tượng & Mục tiêu</h4>
                    {app.targetClientGroups?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {app.targetClientGroups.map((g: string) => (
                          <span key={g} className="text-[10px] px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400">{g}</span>
                        ))}
                      </div>
                    )}
                    {app.primaryTrainingGoals?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {app.primaryTrainingGoals.map((g: string) => (
                          <span key={g} className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-400">{g}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Availability schedule */}
                {app?.availableDays?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Lịch làm việc</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {app.availableDays.map((d: string) => (
                        <span key={d} className="text-[10px] px-2 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-zinc-300 font-medium">{d}</span>
                      ))}
                    </div>
                    {(app.availableFrom || app.availableUntil) && (
                      <p className="text-xs text-zinc-500 mt-1">{app.availableFrom && `Từ ${app.availableFrom}`}{app.availableFrom && app.availableUntil && ' - '}{app.availableUntil && `đến ${app.availableUntil}`}</p>
                    )}
                  </div>
                )}

                {/* Gym affiliation */}
                {app?.gymAffiliation && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Phòng gym</h4>
                    <p className="text-sm text-zinc-300">{app.gymAffiliation}</p>
                  </div>
                )}

                {/* Social links */}
                {(app?.linkedinUrl || app?.websiteUrl || socialLinks.instagram || socialLinks.youtube || socialLinks.tiktok || socialLinks.facebook) && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Links</h4>
                    <div className="flex flex-wrap gap-2">
                      {app.linkedinUrl && isValidUrl(app.linkedinUrl) && (
                        <a href={app.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 transition-colors">
                          <Linkedin className="w-3 h-3" /> LinkedIn
                        </a>
                      )}
                      {app.websiteUrl && isValidUrl(app.websiteUrl) && (
                        <a href={app.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 bg-zinc-800 px-2 py-1 rounded-lg border border-zinc-700/60 transition-colors">
                          <Globe className="w-3 h-3" /> Website
                        </a>
                      )}
                      {socialLinks.instagram && (
                        <span className="flex items-center gap-1.5 text-xs text-pink-400 bg-pink-500/10 px-2 py-1 rounded-lg border border-pink-500/20">
                          <Instagram className="w-3 h-3" /> {socialLinks.instagram}
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
                  <h4 className="text-sm font-bold text-zinc-200 mb-3">Bảng giá</h4>
                  <div className="space-y-3">
                    {/* Per-session options */}
                    {perSessionOptions.map((opt, idx) => {
                      const isBest = opt.price === lowestPerSess;
                      return (
                        <div key={idx} className={`border-2 rounded-xl p-4 transition-all ${isBest ? "border-green-500 bg-green-500/5" : "border-zinc-700/60"}`}>
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-zinc-200">{opt.label}</span>
                                {isBest && <span className="text-xs bg-green-500 text-black px-2 py-0.5 rounded-full font-bold">Giá tốt nhất</span>}
                              </div>
                              <div className="text-xs text-zinc-500">Đặt lịch theo từng buổi</div>
                            </div>
                            <span className="text-base font-bold text-green-400">{formatPrice(opt.price)}</span>
                          </div>
                          <ul className="space-y-1 mb-3">
                            <li className="flex items-center gap-1.5 text-xs text-zinc-400"><Check className="w-3.5 h-3.5 text-green-500" /> Kế hoạch tập luyện từ AI cá nhân hóa</li>
                            <li className="flex items-center gap-1.5 text-xs text-zinc-400"><Check className="w-3.5 h-3.5 text-green-500" /> Hỗ trợ chat trực tiếp</li>
                          </ul>
                          {opt.mode !== null ? (
                            <button
                              onClick={() => handleRequestCoaching("PER_SESSION", opt.mode!)}
                              className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20"
                            >
                              Yêu cầu huấn luyện
                            </button>
                          ) : (
                            <p className="text-center text-xs text-zinc-600 italic">PT cần cập nhật hình thức dịch vụ</p>
                          )}
                        </div>
                      );
                    })}

                    {/* Package options */}
                    {packageOptions.map((opt, idx) => {
                      const isBest = opt.pricePerSess === bestPkgRate;
                      return (
                        <div key={idx} className={`border rounded-xl p-4 transition-all ${isBest ? "border-green-500/50 bg-green-500/5" : "border-zinc-700/60"}`}>
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-zinc-200">{opt.label}</span>
                                {isBest && <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">Tiết kiệm nhất</span>}
                              </div>
                              <div className="text-xs text-zinc-500">{formatPrice(opt.pricePerSess)}/buổi · Gói nhiều buổi</div>
                            </div>
                            <span className="text-base font-bold text-green-400">{formatPrice(opt.price)}</span>
                          </div>
                          {opt.mode !== null ? (
                            <button
                              onClick={() => handleRequestCoaching("PACKAGE", opt.mode!)}
                              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-bold rounded-lg transition-all border border-zinc-700/60"
                            >
                              Yêu cầu huấn luyện
                            </button>
                          ) : (
                            <p className="text-center text-xs text-zinc-600 italic">PT cần cập nhật hình thức dịch vụ</p>
                          )}
                        </div>
                      );
                    })}

                    {/* Fallback if no prices */}
                    {perSessionOptions.length === 0 && packageOptions.length === 0 && (
                      <div className="border rounded-xl p-4 border-zinc-700/60 text-center">
                        <p className="text-sm text-zinc-500">Liên hệ huấn luyện viên để biết chi tiết giá.</p>
                      </div>
                    )}

                    {app?.additionalPricingNotes && (
                      <p className="text-xs text-zinc-600 italic px-1">{app.additionalPricingNotes}</p>
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
            </div>
          );
        })()}
      </div>

      {/* Request Coaching Modal */}
      {showRequestModal && selectedPT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Yêu cầu huấn luyện</h3>
              <button onClick={() => setShowRequestModal(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 bg-zinc-800/50 rounded-xl p-3">
                <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-sm">
                  {selectedPT.firstName?.[0]}{selectedPT.lastName?.[0]}
                </div>
                <div>
                  <div className="text-sm font-bold text-zinc-200">{selectedPT.firstName} {selectedPT.lastName}</div>
                  <div className="text-xs text-zinc-500">
                    {requestType === "PER_SESSION" ? "Theo buổi" : "Gói dịch vụ"}
                    {selectedSessionMode ? ` · ${selectedSessionMode === 'ONLINE' ? 'Online' : 'Offline'}` : ""}
                  </div>
                </div>
              </div>

              {requestType === "PER_SESSION" ? (
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Số buổi tập</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={requestSessions}
                    onChange={e => setRequestSessions(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Số lượng gói</label>
                      <input
                        type="number"
                        min={1}
                        value={packageQuantity}
                        onChange={e => setPackageQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Buổi thêm</label>
                      <input
                        type="number"
                        min={0}
                        value={extraSessions}
                        onChange={e => setExtraSessions(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-zinc-500 italic bg-zinc-800/30 p-2 rounded-lg border border-zinc-700/30">
                    * Mỗi gói gồm <span className="text-zinc-300 font-bold">{selectedPT.ptApplication?.sessionsPerPackage || 10}</span> buổi.
                    Buổi thêm tính theo giá mỗi buổi của gói.
                  </div>
                </div>
              )}

              {(() => {
                const app = selectedPT.ptApplication;
                const priceForCalc = requestType === "PER_SESSION"
                  ? (selectedSessionMode === 'ONLINE'
                      ? (app?.onlinePricePerSession ?? app?.desiredSessionPrice)
                      : selectedSessionMode === 'OFFLINE'
                        ? (app?.offlinePricePerSession ?? app?.desiredSessionPrice)
                        : app?.desiredSessionPrice)
                  : (selectedSessionMode === 'ONLINE'
                      ? (app?.onlinePackagePrice ?? app?.packagePrice)
                      : selectedSessionMode === 'OFFLINE'
                        ? (app?.offlinePackagePrice ?? app?.packagePrice)
                        : app?.packagePrice);

                let totalPrice = 0;
                let totalSess = 0;

                if (requestType === "PER_SESSION") {
                  totalSess = requestSessions;
                  totalPrice = (priceForCalc || 0) * requestSessions;
                } else {
                  const sessPerPack = app?.sessionsPerPackage || 10;
                  totalSess = (sessPerPack * packageQuantity) + extraSessions;
                  const unitPrice = sessPerPack > 0 ? (priceForCalc || 0) / sessPerPack : 0;
                  totalPrice = ((priceForCalc || 0) * packageQuantity) + (extraSessions * unitPrice);
                }

                return totalPrice > 0 ? (
                  <div className="space-y-1 bg-zinc-800/50 rounded-lg px-3 py-3 border border-zinc-700/40">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Tổng buổi tập</span>
                      <span className="font-semibold text-zinc-300">{totalSess} buổi</span>
                    </div>
                    <div className="flex justify-between text-sm pt-1 border-t border-zinc-700/30 mt-1">
                      <span className="text-zinc-400 font-medium">Dự kiến tổng</span>
                      <span className="font-bold text-green-400">{formatPrice(totalPrice)}</span>
                    </div>
                  </div>
                ) : null;
              })()}

              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Gửi lời nhắn cho huấn luyện viên (không bắt buộc)</label>
                <textarea
                  value={requestMessage}
                  onChange={e => setRequestMessage(e.target.value)}
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
              <button
                onClick={submitRequest}
                disabled={requestMutation.isPending}
                className="flex-1 py-3 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
              >
                {requestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {requestMutation.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
