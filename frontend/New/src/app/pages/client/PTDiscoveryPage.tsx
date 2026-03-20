import { useState } from "react";
import { Search, Star, MapPin, Award, Filter, ChevronRight, Check } from "lucide-react";

const pts = [
  { id: 1, name: "Sarah Mitchell", specialty: ["Fat Loss", "Strength Training", "HIIT"], experience: "6 years", rating: 4.9, reviews: 48, price: "฿1,000/session", pkg: "from ฿8,000", avatar: "SM", location: "Bangkok", verified: true, active: 14, bio: "Certified NASM personal trainer specializing in evidence-based fat loss and strength development. I work with clients online and help them build sustainable habits.", packages: [
    { name: "Basic", sessions: 4, price: "฿4,000", features: ["4 video sessions", "AI workout plan", "Chat support"] },
    { name: "Premium", sessions: 12, price: "฿10,000", features: ["12 video sessions", "Custom meal plan", "AI workout plan", "Unlimited chat", "Weekly check-ins"] },
  ]},
  { id: 2, name: "James Kwan", specialty: ["Bodybuilding", "Muscle Gain", "Powerlifting"], experience: "8 years", rating: 4.8, reviews: 62, price: "฿1,200/session", pkg: "from ฿9,600", avatar: "JK", location: "Bangkok", verified: true, active: 18, bio: "Competitive bodybuilder and ISSA-certified coach. I specialize in evidence-based hypertrophy and powerlifting programming.", packages: [
    { name: "Basic", sessions: 4, price: "฿4,800", features: ["4 video sessions", "Workout plan", "Chat support"] },
    { name: "Elite", sessions: 12, price: "฿12,000", features: ["12 video sessions", "Nutrition plan", "Workout plan", "Priority chat"] },
  ]},
  { id: 3, name: "Fiona Park", specialty: ["Yoga", "Mobility", "Women's Health"], experience: "5 years", rating: 4.7, reviews: 35, price: "฿900/session", pkg: "from ฿7,200", avatar: "FP", location: "Chiang Mai", verified: true, active: 9, bio: "Holistic wellness coach focused on movement quality, injury prevention, and women's health.", packages: [
    { name: "Starter", sessions: 4, price: "฿3,600", features: ["4 video sessions", "Flexibility plan", "Chat support"] },
  ]},
];

const filters = ["All", "Fat Loss", "Muscle Gain", "Strength", "Yoga", "HIIT", "Powerlifting"];

export function PTDiscoveryPage() {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [selected, setSelected] = useState<typeof pts[0] | null>(null);

  const filtered = pts.filter(pt =>
    (activeFilter === "All" || pt.specialty.some(s => s.includes(activeFilter))) &&
    (pt.name.toLowerCase().includes(search.toLowerCase()) || pt.specialty.some(s => s.toLowerCase().includes(search.toLowerCase())))
  );

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
        <div className={`space-y-3 ${selected ? "lg:w-96 flex-shrink-0" : "flex-1"}`}>
          {filtered.map(pt => (
            <button key={pt.id} onClick={() => setSelected(selected?.id === pt.id ? null : pt)} className={`w-full text-left bg-zinc-900 rounded-xl border-2 p-4 transition-all ${selected?.id === pt.id ? "border-green-500 bg-green-500/5" : "border-zinc-800/60 hover:border-zinc-700"}`}>
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0">{pt.avatar}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-zinc-200">{pt.name}</span>
                        {pt.verified && <Award className="w-3.5 h-3.5 text-green-400" />}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-zinc-600 mt-0.5">
                        <MapPin className="w-3 h-3" /> {pt.location} · {pt.experience} exp.
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-green-400">{pt.pkg}</div>
                      <div className="flex items-center gap-0.5 justify-end mt-0.5">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <span className="text-xs font-semibold text-zinc-300">{pt.rating}</span>
                        <span className="text-xs text-zinc-600">({pt.reviews})</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {pt.specialty.map(s => <span key={s} className="text-xs bg-zinc-800 border border-zinc-700/40 text-zinc-400 px-2 py-0.5 rounded-full">{s}</span>)}
                  </div>
                  <div className="text-xs text-zinc-600 mt-1">{pt.active} active clients</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden self-start">
            <div className="p-5 border-b border-zinc-800/60">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-xl flex-shrink-0">{selected.avatar}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-zinc-100">{selected.name}</h2>
                    {selected.verified && <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20"><Award className="w-3 h-3" /> Verified</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {selected.location}</span>
                    <span>{selected.experience} experience</span>
                    <span>{selected.active} clients</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {[1,2,3,4,5].map(i => <Star key={i} className={`w-3.5 h-3.5 ${i <= Math.floor(selected.rating) ? "text-amber-400 fill-amber-400" : "text-zinc-700"}`} />)}
                    <span className="text-xs text-zinc-500 ml-1">{selected.rating} ({selected.reviews} reviews)</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-zinc-400 mt-3 leading-relaxed">{selected.bio}</p>
            </div>

            <div className="p-5">
              <h4 className="text-sm font-bold text-zinc-200 mb-3">Service Packages</h4>
              <div className="space-y-3">
                {selected.packages.map((pkg, i) => (
                  <div key={pkg.name} className={`border-2 rounded-xl p-4 ${i === 1 ? "border-green-500 bg-green-500/5" : "border-zinc-800/60"}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-200">{pkg.name}</span>
                          {i === 1 && <span className="text-xs bg-green-500 text-black px-2 py-0.5 rounded-full font-bold">Popular</span>}
                        </div>
                        <div className="text-xs text-zinc-500">{pkg.sessions} sessions</div>
                      </div>
                      <span className="text-base font-bold text-green-400">{pkg.price}</span>
                    </div>
                    <ul className="space-y-1 mb-3">
                      {pkg.features.map(f => (
                        <li key={f} className="flex items-center gap-1.5 text-xs text-zinc-400">
                          <Check className="w-3.5 h-3.5 text-green-500" /> {f}
                        </li>
                      ))}
                    </ul>
                    <button className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                      Request Coaching
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}