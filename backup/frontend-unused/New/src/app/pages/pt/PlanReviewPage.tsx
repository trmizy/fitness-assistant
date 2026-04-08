import { useState } from "react";
import { Brain, Check, X, Edit3, MessageSquare, ChevronDown, ChevronRight } from "lucide-react";

const plansToReview = [
  { id: 1, client: "Alex Johnson", avatar: "AJ", plan: "Fat Loss Program", status: "pending_review", created: "Jun 15" },
  { id: 2, client: "Maria Chen", avatar: "MC", plan: "Muscle Gain Plan", status: "pending_review", created: "Jun 16" },
  { id: 3, client: "Ryan Park", avatar: "RP", plan: "Strength Program", status: "pending_review", created: "Jun 17" },
];

const aiVersion = [
  { day: "Monday", name: "Upper Push", details: "Bench Press 4×8@80kg, Incline DB 3×10@30kg, OHP 3×12@50kg, Tricep 3×15" },
  { day: "Tuesday", name: "Lower Body", details: "Squat 4×8@100kg, RDL 3×10@80kg, Leg Press 3×12, Calf 4×15" },
  { day: "Wednesday", name: "HIIT Cardio", details: "30 min HIIT intervals, 2:1 work:rest ratio" },
  { day: "Thursday", name: "Upper Pull", details: "Pull-ups 4×6, Row 4×8@70kg, Cable Row 3×12, Face Pulls 3×15" },
  { day: "Friday", name: "Full Body", details: "Deadlift 4×5@120kg, Power Clean 3×5, Push Press 3×8" },
  { day: "Saturday", name: "Active Rest", details: "20 min walk, Mobility routine 15 min" },
  { day: "Sunday", name: "Rest", details: "Full rest and recovery" },
];

const ptVersion = [
  { day: "Monday", name: "Upper Push", details: "Bench Press 4×8@80kg, Incline DB 3×10@30kg, OHP 3×12@50kg, Tricep 3×15", changed: false },
  { day: "Tuesday", name: "Lower Body", details: "Squat 4×8@100kg, RDL 3×10@80kg, Leg Press 3×12, Calf 4×15", changed: false },
  { day: "Wednesday", name: "LISS Cardio", details: "40 min treadmill @ 60% HR (changed from HIIT — lower recovery demand)", changed: true },
  { day: "Thursday", name: "Upper Pull", details: "Pull-ups 4×6, Row 4×8@70kg, Cable Row 3×12, Face Pulls 3×15", changed: false },
  { day: "Friday", name: "Full Body", details: "Deadlift 4×5@120kg, Power Clean 3×5, Push Press 3×8", changed: false },
  { day: "Saturday", name: "Active Rest + Core", details: "20 min walk, Core circuit 3 rounds, Mobility (added core work)", changed: true },
  { day: "Sunday", name: "Rest", details: "Full rest and recovery", changed: false },
];

export function PlanReviewPage() {
  const [selected, setSelected] = useState(plansToReview[0]);
  const [ptNote, setPtNote] = useState("Modified Wednesday from HIIT to LISS cardio for better recovery given sleep data. Added core circuit on Saturday based on posture assessment.");
  const [approved, setApproved] = useState<number[]>([]);

  const handleApprove = (id: number) => {
    setApproved(prev => [...prev, id]);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2"><Brain className="w-5 h-5 text-violet-400" /> Plan Review</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Review and adjust AI-generated plans before activating for clients</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Plan list */}
        <div className="lg:w-64 space-y-2 flex-shrink-0">
          <h4 className="text-xs text-zinc-600 uppercase tracking-wider px-1 font-bold">Pending Review</h4>
          {plansToReview.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`w-full text-left p-3 rounded-xl border-2 transition-all ${selected.id === p.id ? "border-violet-500 bg-violet-500/8" : "border-zinc-800/60 bg-zinc-900 hover:border-zinc-700"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">{p.avatar}</div>
                <span className="text-sm font-bold text-zinc-200">{p.client}</span>
                {approved.includes(p.id) && <Check className="w-3.5 h-3.5 text-green-500 ml-auto" />}
              </div>
              <div className="text-xs text-zinc-500">{p.plan}</div>
              <div className="text-xs text-zinc-600 mt-0.5">{p.created}</div>
            </button>
          ))}
        </div>

        {/* Review area */}
        <div className="flex-1 space-y-4">
          {approved.includes(selected.id) ? (
            <div className="bg-green-500/8 border border-green-500/20 rounded-xl p-8 text-center">
              <div className="w-12 h-12 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-green-500/20">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="text-zinc-100 font-bold mb-1">Plan Approved & Activated</h3>
              <p className="text-sm text-zinc-500">{selected.client}'s plan is now active.</p>
            </div>
          ) : (
            <>
              {/* Plan header */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-zinc-100">{selected.plan} — {selected.client}</h3>
                    <p className="text-sm text-zinc-500 mt-0.5">AI generated on {selected.created}. Review the diff below and add your adjustments.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleApprove(selected.id)} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20">
                      <Check className="w-4 h-4" /> Approve
                    </button>
                    <button className="flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-2 rounded-xl text-sm font-semibold hover:bg-red-500/15 transition-colors">
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>

                {/* PT Note */}
                <div className="mt-3">
                  <label className="text-xs text-zinc-500 mb-1.5 block flex items-center gap-1.5 uppercase tracking-wider font-semibold">
                    <MessageSquare className="w-3.5 h-3.5" /> Your note to client
                  </label>
                  <textarea
                    value={ptNote}
                    onChange={e => setPtNote(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 resize-none placeholder-zinc-600"
                  />
                </div>
              </div>

              {/* Side-by-side comparison */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                <div className="grid grid-cols-2 border-b border-zinc-800/60">
                  <div className="px-4 py-2.5 bg-blue-500/8 border-r border-zinc-800/60">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                      <Brain className="w-3.5 h-3.5" /> AI Version
                    </div>
                  </div>
                  <div className="px-4 py-2.5 bg-green-500/5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-green-400">
                      <Edit3 className="w-3.5 h-3.5" /> PT Adjusted Version
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-zinc-800/40">
                  {aiVersion.map((ai, i) => {
                    const pt = ptVersion[i];
                    return (
                      <div key={ai.day} className={`grid grid-cols-2 ${pt.changed ? "bg-amber-500/5" : ""}`}>
                        <div className="px-4 py-3 border-r border-zinc-800/60">
                          <div className="text-xs font-bold text-zinc-300 mb-0.5">{ai.day}</div>
                          <div className="text-xs text-zinc-400 font-semibold mb-0.5">{ai.name}</div>
                          <div className="text-xs text-zinc-600 leading-relaxed">{ai.details}</div>
                        </div>
                        <div className={`px-4 py-3 ${pt.changed ? "bg-amber-500/5" : ""}`}>
                          <div className="flex items-center gap-1 mb-0.5">
                            <div className="text-xs font-bold text-zinc-300">{pt.day}</div>
                            {pt.changed && <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">Modified</span>}
                          </div>
                          <div className="text-xs font-semibold text-zinc-400 mb-0.5">{pt.name}</div>
                          <div className="text-xs text-zinc-500 leading-relaxed">{pt.details}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}