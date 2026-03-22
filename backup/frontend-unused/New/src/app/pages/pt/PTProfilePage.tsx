import { useState } from "react";
import { Award, Edit3, Check, Plus, Star } from "lucide-react";

export function PTProfilePage() {
  const [editing, setEditing] = useState(false);
  const [verificationStatus] = useState<"pending" | "approved">("approved");

  const verificationConfig = {
    not_pt: { label: "Not PT", color: "bg-zinc-700/50 text-zinc-400 border-zinc-700" },
    pending: { label: "Pending Review", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    approved: { label: "Approved PT", color: "bg-green-500/10 text-green-400 border-green-500/20" },
    rejected: { label: "Rejected", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  };

  const packages = [
    { name: "Basic", sessions: 4, price: 4000, features: ["4 video sessions", "Workout plan", "Chat support"] },
    { name: "Premium", sessions: 12, price: 10000, features: ["12 video sessions", "Custom meal plan", "Workout plan", "Unlimited chat"] },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100">PT Profile & Services</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Manage your public profile and coaching packages</p>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg ${editing ? "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20" : "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20"}`}
        >
          {editing ? <><Check className="w-4 h-4" /> Save</> : <><Edit3 className="w-4 h-4" /> Edit Profile</>}
        </button>
      </div>

      {/* Verification status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${verificationStatus === "approved" ? "bg-green-500/8 border-green-500/20" : "bg-amber-500/8 border-amber-500/20"}`}>
        <Award className={`w-5 h-5 ${verificationStatus === "approved" ? "text-green-400" : "text-amber-400"}`} />
        <div>
          <div className="text-sm font-bold text-zinc-200">PT Verification Status</div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${verificationConfig[verificationStatus].color}`}>
            {verificationConfig[verificationStatus].label}
          </span>
        </div>
        {verificationStatus === "approved" && (
          <div className="ml-auto flex items-center gap-1 text-green-400 text-sm font-bold">
            <Check className="w-4 h-4" /> Verified Coach
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Public profile */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Public Profile</h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Display Name</label>
                {editing ? <input defaultValue="Sarah Mitchell" className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" /> : <p className="text-sm font-semibold text-zinc-200 py-2">Sarah Mitchell</p>}
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Bio</label>
                {editing ? <textarea rows={3} defaultValue="Certified NASM personal trainer specializing in evidence-based fat loss and strength development. 6+ years experience coaching online clients worldwide." className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 resize-none" /> : <p className="text-sm text-zinc-400 py-2 leading-relaxed">Certified NASM personal trainer specializing in evidence-based fat loss and strength development. 6+ years experience coaching online clients worldwide.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Specialties</label>
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {["Fat Loss", "Strength Training", "HIIT", "Nutrition"].map(s => (
                      <span key={s} className="px-2 py-0.5 bg-zinc-800 border border-zinc-700/40 text-zinc-400 text-xs rounded-full">{s}</span>
                    ))}
                    {editing && <button className="px-2 py-0.5 border border-dashed border-green-500/40 text-green-400 text-xs rounded-full"><Plus className="w-3 h-3" /></button>}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Experience</label>
                  {editing ? <input defaultValue="6 years" className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" /> : <p className="text-sm font-semibold text-zinc-200 py-2">6 years</p>}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Certifications</label>
                <div className="flex flex-wrap gap-2 py-1">
                  {["NASM CPT", "Precision Nutrition L1", "TRX Certified"].map(c => (
                    <span key={c} className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs rounded-full">
                      <Award className="w-3 h-3" /> {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Packages */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-zinc-200">Service Packages</h4>
              {editing && <button className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"><Plus className="w-3.5 h-3.5" /> Add Package</button>}
            </div>
            <div className="space-y-3">
              {packages.map((pkg, i) => (
                <div key={pkg.name} className={`p-4 border-2 rounded-xl ${i === 1 ? "border-green-500 bg-green-500/5" : "border-zinc-800/60"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-bold text-zinc-200">{pkg.name}</span>
                      <span className="text-xs text-zinc-600 ml-2">{pkg.sessions} sessions</span>
                    </div>
                    {editing ? (
                      <input defaultValue={pkg.price} className="w-24 px-2 py-1 border border-zinc-700/60 rounded text-sm text-right font-bold text-green-400 bg-zinc-800/60" />
                    ) : (
                      <span className="text-base font-bold text-green-400">฿{pkg.price.toLocaleString()}</span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {pkg.features.map(f => (
                      <li key={f} className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <Check className="w-3.5 h-3.5 text-green-500" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-4">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Profile Stats</h4>
            <div className="space-y-3">
              {[
                { label: "Rating", value: "4.9", sub: "48 reviews", icon: Star, color: "text-amber-400" },
                { label: "Active Clients", value: "14", sub: "this month", icon: null, color: "text-green-400" },
                { label: "Sessions Done", value: "342", sub: "total", icon: null, color: "text-blue-400" },
              ].map(stat => (
                <div key={stat.label} className="flex items-center justify-between py-2 border-b border-zinc-800/40 last:border-0">
                  <div className="text-sm text-zinc-500">{stat.label}</div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${stat.color} flex items-center gap-1 justify-end`}>
                      {stat.icon && <stat.icon className="w-3.5 h-3.5 fill-current" />}
                      {stat.value}
                    </div>
                    <div className="text-xs text-zinc-600">{stat.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Availability</h4>
            <div className="space-y-2">
              {["Mon", "Tue", "Thu", "Fri"].map(d => (
                <div key={d} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">{d}</span>
                  <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">9am – 5pm</span>
                </div>
              ))}
              {["Wed", "Sat", "Sun"].map(d => (
                <div key={d} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">{d}</span>
                  <span className="text-xs text-zinc-600 px-2 py-0.5">Unavailable</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}