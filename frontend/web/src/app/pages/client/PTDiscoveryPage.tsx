import { useState } from "react";
import { useNavigate } from "react-router";
import { Search, Star, MapPin, Award, Filter, ChevronRight, Check, Loader2, Users, MessageSquare, Clock, Dumbbell, DollarSign, Briefcase, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { profileService, chatService, contractService } from "../../services/api";
import { toast } from "sonner";

function formatPrice(price?: number | null) {
  if (!price) return null;
  return `฿${price.toLocaleString()}`;
}

const filters = ["All", "Fat Loss", "Muscle Gain", "Strength", "Yoga", "HIIT", "Powerlifting"];

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
  const [requestSessions, setRequestSessions] = useState(1); // Used for PER_SESSION
  const [packageQuantity, setPackageQuantity] = useState(1);
  const [extraSessions, setExtraSessions] = useState(0);
  const [requestMessage, setRequestMessage] = useState("");

  const handleMessage = async (ptUserId: string) => {
    try {
      setMessagingPT(true);
      const data = await chatService.createDirectConversation(ptUserId);
      const conversationId = data?.id || data?.conversation?.id;
      if (conversationId) {
        navigate(`/client/chat`);
      }
    } catch {
      toast.error("Failed to start conversation");
    } finally {
      setMessagingPT(false);
    }
  };

  const requestMutation = useMutation({
    mutationFn: (data: any) =>
      contractService.requestContract(data),
    onSuccess: () => {
      toast.success("Coaching request sent! The trainer will review your request.");
      setShowRequestModal(false);
      setRequestMessage("");
      setRequestSessions(1);
      setPackageQuantity(1);
      setExtraSessions(0);
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || "Failed to send request";
      toast.error(msg);
    },
  });

  const handleRequestCoaching = (type: "PER_SESSION" | "PACKAGE") => {
    setRequestType(type);
    if (type === "PER_SESSION") {
      setRequestSessions(1);
    } else {
      setPackageQuantity(1);
      setExtraSessions(0);
    }
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
      totalSessions: requestType === "PER_SESSION" ? requestSessions : 0, // Ignored by backend if PACKAGE
      message: requestMessage || undefined,
    });
  };

  const { data: ptsData, isLoading } = useQuery({
    queryKey: ["pts-list"],
    queryFn: profileService.listPTs
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
     const matchesSearch = (pt.firstName + " " + pt.lastName).toLowerCase().includes(search.toLowerCase());
     return matchesSearch;
  });

  const selectedPT = ptsList.find((pt: any) => pt.userId === selectedId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2"><Search className="w-5 h-5 text-green-400" /> Find a Coach</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Browse certified personal trainers and start your coaching journey</p>
      </div>

      {/* Search & filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or specialty…" className="flex-1 text-sm outline-none text-zinc-300 placeholder-zinc-600 bg-transparent" />
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
          <Filter className="w-4 h-4" /> Filters
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map(f => (
          <button key={f} onClick={() => setActiveFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${activeFilter === f ? "bg-green-500 text-black border-green-500 shadow-lg shadow-green-500/20" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40 hover:text-zinc-200"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* PT cards */}
        <div className={`space-y-3 ${selectedId ? "lg:w-96 flex-shrink-0" : "flex-1"}`}>
          {filtered.length > 0 ? filtered.map((pt: any) => (
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
                        {pt.ptApplication?.yearsOfExperience ? ` · ${pt.ptApplication.yearsOfExperience} exp.` : " · Certified"}
                      </div>
                    </div>
                    {pt.ptApplication?.desiredSessionPrice && (
                      <span className="text-xs font-bold text-green-400 whitespace-nowrap">
                        from {formatPrice(pt.ptApplication.desiredSessionPrice)}
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
          )) : (
            <div className="py-20 text-center bg-zinc-900/50 rounded-2xl border border-zinc-800/60">
               <Users className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
               <p className="text-zinc-500">No trainers found matching your search.</p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedPT && (
          <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden self-start">
            {(() => {
              const app = selectedPT.ptApplication;
              const hasSessionPrice = !!app?.desiredSessionPrice;
              const hasPackagePrice = !!app?.packagePrice;
              const certs = app?.certificates?.filter((c: any) => c.isCurrentlyValid) || [];

              return (
                <>
                  <div className="p-5 border-b border-zinc-800/60">
                    <div className="flex items-start gap-4">
                      <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-xl flex-shrink-0">
                        {selectedPT.firstName?.[0]}{selectedPT.lastName?.[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-zinc-100">{selectedPT.firstName} {selectedPT.lastName}</h2>
                          <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20"><Award className="w-3 h-3" /> Verified</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1 flex-wrap">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {app?.operatingAreas?.[0] || "Bangkok"}</span>
                          {app?.yearsOfExperience && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {app.yearsOfExperience} experience</span>}
                          {app?.serviceMode && <span className="capitalize">{app.serviceMode.toLowerCase().replace('_', ' ')}</span>}
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
                      {app?.professionalBio || "Expert fitness coaching available. Connect with this trainer to start your personalized journey."}
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

                  <div className="p-5">
                    <h4 className="text-sm font-bold text-zinc-200 mb-3">Pricing</h4>
                    <div className="space-y-3">
                      {/* Per-session */}
                      {hasSessionPrice && (
                        <div className="border-2 rounded-xl p-4 border-green-500 bg-green-500/5">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-zinc-200">Per Session</span>
                                <span className="text-xs bg-green-500 text-black px-2 py-0.5 rounded-full font-bold">Popular</span>
                              </div>
                              <div className="text-xs text-zinc-500">Single session booking</div>
                            </div>
                            <span className="text-base font-bold text-green-400">{formatPrice(app.desiredSessionPrice)}</span>
                          </div>
                          <ul className="space-y-1 mb-3">
                            <li className="flex items-center gap-1.5 text-xs text-zinc-400"><Check className="w-3.5 h-3.5 text-green-500" /> Customized AI Workout Plan</li>
                            <li className="flex items-center gap-1.5 text-xs text-zinc-400"><Check className="w-3.5 h-3.5 text-green-500" /> Direct Chat Support</li>
                          </ul>
                          <button
                            onClick={() => handleRequestCoaching("PER_SESSION")}
                            className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20"
                          >
                            Request Coaching
                          </button>
                        </div>
                      )}

                      {/* Package */}
                      {hasPackagePrice && (
                        <div className="border rounded-xl p-4 border-zinc-700/60">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <span className="text-sm font-bold text-zinc-200">Package ({app.sessionsPerPackage || 10} sessions)</span>
                              <div className="text-xs text-zinc-500">Multi-session bundle</div>
                            </div>
                            <span className="text-base font-bold text-green-400">{formatPrice(app.packagePrice)}</span>
                          </div>
                          <button
                            onClick={() => handleRequestCoaching("PACKAGE")}
                            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-bold rounded-lg transition-all border border-zinc-700/60"
                          >
                            Request Coaching
                          </button>
                        </div>
                      )}

                      {/* Fallback if no prices set */}
                      {!hasSessionPrice && !hasPackagePrice && (
                        <div className="border rounded-xl p-4 border-zinc-700/60 text-center">
                          <p className="text-sm text-zinc-500">Contact this trainer for pricing details.</p>
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
                      {messagingPT ? "Opening chat…" : "Message"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Request Coaching Modal */}
      {showRequestModal && selectedPT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Request Coaching</h3>
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
                  <div className="text-xs text-zinc-500">{requestType === "PER_SESSION" ? "Per Session Mode" : "Package Mode"}</div>
                </div>
              </div>

              {requestType === "PER_SESSION" ? (
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Number of Sessions</label>
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
                      <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Package Quantity</label>
                      <input
                        type="number"
                        min={1}
                        value={packageQuantity}
                        onChange={e => setPackageQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Extra Sessions</label>
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
                    * Each package includes <span className="text-zinc-300 font-bold">{selectedPT.ptApplication?.sessionsPerPackage || 10}</span> sessions. 
                    Extra sessions are priced at the package's daily rate.
                  </div>
                </div>
              )}

              {(() => {
                const app = selectedPT.ptApplication;
                let totalPrice = 0;
                let totalSess = 0;

                if (requestType === "PER_SESSION") {
                   totalSess = requestSessions;
                   totalPrice = (app?.desiredSessionPrice || 0) * requestSessions;
                } else {
                   const sessPerPack = app?.sessionsPerPackage || 10;
                   totalSess = (sessPerPack * packageQuantity) + extraSessions;
                   const unitPrice = sessPerPack > 0 ? (app?.packagePrice || 0) / sessPerPack : 0;
                   totalPrice = ((app?.packagePrice || 0) * packageQuantity) + (extraSessions * unitPrice);
                }

                return totalPrice > 0 ? (
                  <div className="space-y-1 bg-zinc-800/50 rounded-lg px-3 py-3 border border-zinc-700/40">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Total Sessions</span>
                      <span className="font-semibold text-zinc-300">{totalSess} sessions</span>
                    </div>
                    <div className="flex justify-between text-sm pt-1 border-t border-zinc-700/30 mt-1">
                      <span className="text-zinc-400 font-medium">Estimated Total</span>
                      <span className="font-bold text-green-400">{formatPrice(totalPrice)}</span>
                    </div>
                  </div>
                ) : null;
              })()}

              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Message to Trainer (optional)</label>
                <textarea
                  value={requestMessage}
                  onChange={e => setRequestMessage(e.target.value)}
                  rows={2}
                  placeholder="Tell the trainer about your goals, availability, etc."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => setShowRequestModal(false)}
                className="flex-1 py-3 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitRequest}
                disabled={requestMutation.isPending}
                className="flex-1 py-3 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
              >
                {requestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {requestMutation.isPending ? "Sending…" : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
