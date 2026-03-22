import { useState } from "react";
import { FileText, CheckCircle, Clock, XCircle, AlertCircle, Calendar, Shield, User, ChevronRight, PenLine } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useNavigate } from "react-router";

type ContractStatus = "active" | "pending_signature" | "completed" | "expired" | "cancelled" | "draft";

const statusConfig: Record<ContractStatus, { label: string; color: string; dot: string; icon: React.ElementType }> = {
  active: { label: "Active", color: "bg-green-500/10 text-green-400 border-green-500/20", dot: "bg-green-500", icon: CheckCircle },
  pending_signature: { label: "Pending Signature", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-500", icon: PenLine },
  completed: { label: "Completed", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", dot: "bg-blue-500", icon: CheckCircle },
  expired: { label: "Expired", color: "bg-zinc-700/50 text-zinc-400 border-zinc-700", dot: "bg-zinc-500", icon: Clock },
  cancelled: { label: "Cancelled", color: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-400", icon: XCircle },
  draft: { label: "Draft", color: "bg-zinc-700/50 text-zinc-400 border-zinc-700", dot: "bg-zinc-500", icon: FileText },
};

// Mock data cleared - show empty state until backend is ready
const contracts: any[] = [];

export function ContractPage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<any>(null);

  if (contracts.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
              <FileText className="w-5 h-5 text-green-400" /> Contracts
            </h1>
            <p className="text-zinc-500 text-sm mt-0.5">Your coaching agreements and service packages</p>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No contracts yet</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto mb-6">You don't have any active coaching contracts. Browse our trainers to get started!</p>
          <button onClick={() => navigate("/client/coaches")} className="px-6 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-500/20">
            Find a Coach
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <FileText className="w-5 h-5 text-green-400" /> Contracts
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Your coaching agreements and service packages</p>
        </div>
        <button className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/25">
          + New Contract
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Contract list */}
        <div className="lg:w-72 space-y-2 flex-shrink-0">
          {contracts.map((c) => {
            const cfg = statusConfig[c.status as ContractStatus];
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${selected?.id === c.id ? "border-green-500 bg-green-500/8" : "border-zinc-800/60 bg-zinc-900 hover:border-zinc-700"}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xs font-mono text-zinc-600">{c.id}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>{cfg.label}</span>
                </div>
                <div className="text-sm font-bold text-zinc-200">{c.package}</div>
                <div className="text-xs text-zinc-500 mt-0.5">with {c.pt}</div>
                <div className="text-xs text-zinc-600 mt-1">{c.startDate} – {c.endDate}</div>
              </button>
            );
          })}
        </div>

        {/* Contract detail */}
        {selected && (
          <div className="flex-1 space-y-4">
            {/* Status header */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h2 className="text-zinc-100 text-lg font-bold">{selected.package}</h2>
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${statusConfig[selected.status as ContractStatus].color}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${statusConfig[selected.status as ContractStatus].dot}`} />
                      {statusConfig[selected.status as ContractStatus].label}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-zinc-600">{selected.id}</p>
                </div>
                <div className="text-lg font-bold text-green-400">{selected.price}</div>
              </div>

              {/* Parties */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/40">
                  <div className="w-9 h-9 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-sm font-bold text-green-400 flex-shrink-0 uppercase">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Client</div>
                    <div className="text-sm font-semibold text-zinc-200">{user?.firstName} {user?.lastName}</div>
                    {selected.clientSigned && <div className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Signed</div>}
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/40">
                  <div className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400 flex-shrink-0 uppercase">
                    {selected.pt?.[0]}
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Personal Trainer</div>
                    <div className="text-sm font-semibold text-zinc-200">{selected.pt}</div>
                    {selected.ptSigned && <div className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Signed</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
                <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Start Date</div>
                <div className="text-sm font-bold text-zinc-200">{selected.startDate}</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
                <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> End Date</div>
                <div className="text-sm font-bold text-zinc-200">{selected.endDate}</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 col-span-2 sm:col-span-1">
                <div className="text-xs text-zinc-500 mb-2">Sessions Used</div>
                <div className="flex items-end gap-2 mb-1">
                  <span className="text-lg font-bold text-zinc-100">{selected.sessions.used}</span>
                  <span className="text-sm text-zinc-500 mb-0.5">/ {selected.sessions.total}</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all shadow-[0_0_8px_rgba(34,197,94,0.4)]" style={{ width: `${(selected.sessions.used / selected.sessions.total) * 100}%` }} />
                </div>
                <div className="text-xs text-zinc-600 mt-1">{selected.sessions.remaining} remaining</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Services */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-green-400" />
                  <h4 className="text-sm font-bold text-zinc-200">Package Includes</h4>
                </div>
                <ul className="space-y-2">
                  {selected.services.map((s: string) => (
                    <li key={s} className="flex items-center gap-2 text-sm text-zinc-400">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Timeline */}
              {selected.timeline?.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                  <h4 className="text-sm font-bold text-zinc-200 mb-3">Contract Timeline</h4>
                  <div className="space-y-3">
                    {selected.timeline.map((t: any, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${t.done ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-zinc-800 border border-zinc-700"}`}>
                          {t.done ? <CheckCircle className="w-3 h-3 text-black" /> : <div className="w-2 h-2 bg-zinc-600 rounded-full" />}
                        </div>
                        <div className="flex-1">
                          <div className={`text-sm ${t.done ? "text-zinc-200 font-semibold" : "text-zinc-600"}`}>{t.event}</div>
                          <div className="text-xs text-zinc-600">{t.date}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Terms summary */}
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-zinc-400 mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-zinc-500" /> Terms Summary
              </h4>
              <ul className="space-y-1 text-xs text-zinc-600">
                <li>• Sessions must be booked at least 24 hours in advance</li>
                <li>• Cancellations within 12 hours will count as a used session</li>
                <li>• Contract auto-expires on {selected.endDate}. Unused sessions are forfeited.</li>
                <li>• Disputes are handled through platform mediation process</li>
              </ul>
            </div>

            {/* Actions */}
            {selected.status === "active" && (
              <div className="flex flex-wrap gap-2">
                <button className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20">
                  <Calendar className="w-4 h-4" /> Book Session
                </button>
                <button className="flex items-center gap-2 border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
                  Download PDF
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
