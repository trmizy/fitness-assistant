import { useState } from "react";
import {
  Check, X, Award, Zap, Search, ChevronRight,
  Shield, Briefcase, Users, Calendar, Globe, AlertCircle,
  Clock, Eye, FileText, MessageSquare, CheckCircle, XCircle,
  ArrowLeft, Phone, MapPin, Instagram, Youtube, Linkedin,
  RefreshCw, Image as ImageIcon, Loader2, ChevronLeft,
  User, ShieldCheck, History as HistoryIcon,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ptApplicationService, PTApplication } from "../../services/ptApplicationService";
const API_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000';

const getFullUrl = (url?: string) => {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  return `${API_URL.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
};

/* ── Status config ──────────────────────────────────────── */
const statusConfig: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  SUBMITTED: { label: "Submitted", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", dot: "bg-blue-500" },
  UNDER_REVIEW: { label: "Under Review", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", dot: "bg-amber-500" },
  NEEDS_MORE_INFO: { label: "Info Required", bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", dot: "bg-orange-500" },
  APPROVED: { label: "Approved", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20", dot: "bg-green-500" },
  REJECTED: { label: "Rejected", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-500" },
  DRAFT: { label: "Draft", bg: "bg-zinc-700/50", text: "text-zinc-400", border: "border-zinc-700", dot: "bg-zinc-500" },
};

type App = PTApplication;
type FilterKey = "all" | keyof typeof statusConfig;

/* ── InfoRow component ─────────────────────────────────── */
function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-3 text-sm py-1.5 border-b border-zinc-800/40 last:border-0">
      <span className="text-zinc-500 w-36 flex-shrink-0 text-xs mt-0.5">{label}</span>
      <span className={`${highlight ? "text-green-400 font-semibold" : "text-zinc-300"} font-medium text-xs`}>{value || "—"}</span>
    </div>
  );
}

/* ── Document thumbnail ─────────────────────────────────── */
function DocThumb({ label, url, tag }: { label: string; url?: string; tag?: string }) {
  const fullUrl = getFullUrl(url);
  return (
    <div className={`rounded-xl overflow-hidden border-2 transition-all ${url ? "border-green-500/30" : "border-red-500/20"}`}>
      <div className={`h-40 flex items-center justify-center relative ${url ? "bg-zinc-800/60" : "bg-red-500/5"}`}>
        {fullUrl ? (
          <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-20" />
        ) : null}
        {fullUrl ? (
          <>
            <img src={fullUrl} alt={label} className="absolute inset-0 w-full h-full object-cover opacity-50 hover:opacity-100 transition-opacity" />
            <div className="relative z-10 text-center pointer-events-none bg-black/40 px-2 py-1 rounded-md backdrop-blur-xs">
              <ImageIcon className="w-5 h-5 text-green-400 mx-auto mb-1 opacity-70" />
              <p className="text-[10px] text-zinc-100 font-bold">Click to Expand</p>
            </div>
            {tag && <span className="absolute top-2 right-2 text-[10px] bg-zinc-900/90 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-md font-bold z-30">{tag}</span>}
          </>
        ) : (
          <div className="text-center">
            <XCircle className="w-7 h-7 text-red-400/60 mx-auto mb-1" />
            <p className="text-xs text-red-400">Not uploaded</p>
          </div>
        )}
      </div>
      <div className={`px-3 py-2 flex items-center justify-between ${url ? "bg-zinc-900" : "bg-red-500/5"}`}>
        <span className="text-[10px] font-bold text-zinc-300 truncate uppercase tracking-tighter">{label}</span>
        {url ? <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DOCUMENT VIEWER MODAL
   ═══════════════════════════════════════════════════════════ */
function DocumentViewer({ app, onClose }: { app: App; onClose: () => void }) {
  const [section, setSection] = useState<1 | 2 | 3>(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-lg flex items-center justify-center text-xs font-bold text-green-400">
              {app.user?.firstName?.[0] || "U"}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100">Document Review — {app.user?.firstName} {app.user?.lastName}</h3>
              <p className="text-xs text-zinc-500">Submitted {new Date(app.updatedAt).toLocaleDateString()}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-zinc-800/60 bg-zinc-900/60">
          {([
            { key: 1 as const, label: "Identity Verification", icon: Shield },
            { key: 2 as const, label: "Pro Certificates", icon: Award },
            { key: 3 as const, label: "Portfolio / Photos", icon: ImageIcon },
          ]).map(t => (
            <button key={t.key} onClick={() => setSection(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[10px] font-bold border-b-2 transition-all min-w-0 ${section === t.key
                  ? "border-green-500 text-green-400 bg-green-500/8"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}>
              <t.icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Section body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {section === 1 && (
            <>
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Declared Citizen ID Number</p>
                <p className={`text-base font-mono tracking-widest font-bold ${app.nationalIdNumber ? "text-green-400" : "text-red-400 italic"}`}>
                  {app.nationalIdNumber || "Not provided"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DocThumb label="ID Card (Front)" url={app.idCardFrontUrl} tag="Front" />
                <DocThumb label="ID Card (Back)" url={app.idCardBackUrl} tag="Back" />
              </div>
              <DocThumb label="Portrait Photo" url={app.portraitPhotoUrl} tag="Portrait" />
            </>
          )}

          {section === 2 && (
            <div className="space-y-4">
              {app.certificates?.map((c, i) => (
                <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <h4 className="text-sm font-bold text-zinc-200">{c.certificateName}</h4>
                    {c.isCurrentlyValid ? (
                      <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20 font-bold">Valid</span>
                    ) : (
                      <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full border border-red-500/20 font-bold">Expired</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-zinc-500">Org:</span> <span className="text-zinc-300">{c.issuingOrganization}</span></div>
                    <div><span className="text-zinc-500">Date:</span> <span className="text-zinc-300">{c.issueDate ? new Date(c.issueDate).toLocaleDateString() : "-"}</span></div>
                  </div>
                  <DocThumb label="Certificate File" url={c.certificateFileUrl} tag="Cert" />
                </div>
              ))}
              {(!app.certificates || app.certificates.length === 0) && (
                <div className="text-center py-10">
                  <Award className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
                  <p className="text-sm text-zinc-500">No certificates uploaded.</p>
                </div>
              )}
            </div>
          )}

          {section === 3 && (
            <div className="grid grid-cols-2 gap-3">
              {app.media?.filter(m => m.mediaGroup === "PORTFOLIO").map((m, i) => (
                <DocThumb key={i} label={`Portfolio ${i + 1}`} url={m.fileUrl} tag="Media" />
              ))}
              {(!app.media || app.media.length === 0) && (
                <div className="col-span-2 text-center py-10">
                  <ImageIcon className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
                  <p className="text-sm text-zinc-500">No portfolio media uploaded.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800/60 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-zinc-800 text-zinc-300 text-xs font-bold rounded-lg hover:bg-zinc-700">Close Review</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DETAIL VIEW
   ═══════════════════════════════════════════════════════════ */
function DetailView({ app, onBack }: { app: App; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [adminNote, setAdminNote] = useState(app.adminNote || "");
  const [feedback, setFeedback] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const cfg = statusConfig[app.status || "DRAFT"];

  const actionMutation = useMutation({
    mutationFn: ({ action, note, feedback }: { action: string; note?: string; feedback?: string }) =>
      ptApplicationService.reviewAction(app.id, action as any, { adminNote: note, feedback }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pt-applications'] });
      alert("Action completed successfully.");
      onBack();
    },
    onError: (err: any) => alert(err.response?.data?.error || "Action failed.")
  });

  return (
    <>
      {showDocs && <DocumentViewer app={app} onClose={() => setShowDocs(false)} />}
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-zinc-100 font-bold">Review: {app.user?.firstName} {app.user?.lastName}</h1>
          <div className="ml-auto">
            <span className={`inline-flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded-full font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 text-center">
              <div className="w-20 h-20 bg-green-500/15 border border-green-500/20 rounded-2xl flex items-center justify-center text-xl font-bold text-green-400 mx-auto mb-3">
                {app.user?.firstName?.[0]}
              </div>
              <h3 className="text-zinc-100 font-bold">{app.user?.firstName} {app.user?.lastName}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{app.user?.email}</p>

              <button onClick={() => setShowDocs(true)} className="mt-5 w-full flex items-center justify-center gap-2 py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold rounded-xl transition-colors">
                <Eye className="w-3.5 h-3.5" /> View Documents
              </button>
            </div>

            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-6">
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase mb-3 flex items-center gap-2">
                  <User className="w-3.5 h-3.5" /> Professional Bio & Approach
                </p>
                <p className="text-sm text-zinc-300 leading-relaxed italic bg-zinc-800/30 p-4 rounded-lg border border-zinc-700/30">
                  "{app.professionalBio || "Applicant did not provide a bio."}"
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-bold text-zinc-500 uppercase mb-3 flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5" /> Background & Education
                  </p>
                  <p className="text-sm text-zinc-300">{app.educationBackground || "None provided"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-500 uppercase mb-3 flex items-center gap-2">
                    <HistoryIcon className="w-3.5 h-3.5" /> Past Experience
                  </p>
                  <p className="text-sm text-zinc-300">{app.previousWorkExperience || "None provided"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase mb-3">Main Specialties</p>
                <div className="flex flex-wrap gap-2">
                  {app.mainSpecialties?.length > 0 ? (
                    app.mainSpecialties.map(s => (
                      <span key={s} className="px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 text-[10px] font-bold border border-green-500/20 uppercase tracking-wider">
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-zinc-600 text-xs italic">No specialties selected</span>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800/60 space-y-4">
                <div className="flex items-center gap-4 p-3 rounded-xl bg-zinc-800/30 border border-zinc-700/30">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 shadow-inner">
                    <Phone className="w-5 h-5 text-zinc-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-0.5">Contact Phone</p>
                    <p className="text-sm text-zinc-200 font-semibold truncate">{app.phoneNumber || "Not provided"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 rounded-xl bg-zinc-800/30 border border-zinc-700/30">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-5">
              <p className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" /> Service & Availability
              </p>
              <div className="space-y-3">
                <InfoRow label="Experience" value={app.yearsOfExperience ? `${app.yearsOfExperience} years` : "N/A"} />
                <InfoRow label="Service Mode" value={app.serviceMode} highlight />
                <InfoRow label="Operating Areas" value={app.operatingAreas?.join(", ") || "N/A"} />
                <div className="pt-2 border-t border-zinc-800/40">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase mb-2">Available Schedule</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {app.availableDays?.map(d => (
                      <span key={d} className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 text-[10px] border border-zinc-700">{d}</span>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-400">
                    <Clock className="w-3 h-3 inline mr-1 text-zinc-500" />
                    {app.availableFrom && app.availableUntil ? `${app.availableFrom} - ${app.availableUntil}` : "No time set"}
                  </p>
                  {app.availabilityNotes && <p className="text-[10px] text-zinc-500 mt-2 italic">Note: {app.availabilityNotes}</p>}
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-4">
              <p className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Coaching Focus
              </p>
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] text-zinc-600 font-bold uppercase mb-2">Target Audience</p>
                  <div className="flex flex-wrap gap-1.5">
                    {app.targetClientGroups?.map(t => (
                      <span key={t} className="px-2 py-0.5 rounded-md bg-blue-500/5 text-blue-400 text-[10px] border border-blue-500/10">{t}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600 font-bold uppercase mb-2">Training Goals</p>
                  <div className="flex flex-wrap gap-1.5">
                    {app.primaryTrainingGoals?.map(g => (
                      <span key={g} className="px-2 py-0.5 rounded-md bg-purple-500/5 text-purple-400 text-[10px] border border-purple-500/10">{g}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600 font-bold uppercase mb-2">Approach & Methods</p>
                  <p className="text-xs text-zinc-300 leading-relaxed">{app.trainingMethodsApproach || "Not specified"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
                  {app.mainSpecialties?.map(s => <span key={s} className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full text-[10px] border border-zinc-700">{s}</span>)}
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-4">
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase mb-2">Admin Internal Note</p>
                <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-200 resize-none outline-none focus:border-green-500" placeholder="Internal notes..." />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase mb-2">Feedback to Applicant</p>
                <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-200 resize-none outline-none focus:border-orange-500" placeholder="Message to applicant..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => actionMutation.mutate({ action: 'APPROVE', note: adminNote, feedback })} className="bg-green-500 text-black py-2.5 rounded-xl font-bold text-xs hover:bg-green-400">Approve</button>
                <button onClick={() => actionMutation.mutate({ action: 'REQUEST_INFO', note: adminNote, feedback })} className="bg-zinc-800 text-orange-400 border border-orange-400/20 py-2.5 rounded-xl font-bold text-xs hover:bg-zinc-700">Needs Info</button>
                <button onClick={() => actionMutation.mutate({ action: 'REJECT', note: adminNote, feedback })} className="bg-zinc-800 text-red-500 border border-red-500/20 py-2.5 rounded-xl font-bold text-xs hover:bg-zinc-700">Reject</button>
                <button onClick={() => actionMutation.mutate({ action: 'UNDER_REVIEW', note: adminNote, feedback })} className="bg-zinc-800 text-zinc-400 border border-zinc-700 py-2.5 rounded-xl font-bold text-xs hover:bg-zinc-700">Under Review</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN LIST VIEW
   ═══════════════════════════════════════════════════════════ */
export function PTManagement() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<App | null>(null);

  const { data: applications = [], isLoading } = useQuery({
    queryKey: ['admin-pt-applications', filter],
    queryFn: () => ptApplicationService.listApplications(filter === "all" ? undefined : filter as any)
  });

  if (selected) {
    return <DetailView app={selected} onBack={() => setSelected(null)} />;
  }

  const filtered = applications.filter(a => {
    const term = search.toLowerCase();
    if (!term) return true;
    const fName = a.user?.firstName?.toLowerCase() || "";
    const lName = a.user?.lastName?.toLowerCase() || "";
    const email = a.user?.email?.toLowerCase() || "";
    return fName.includes(term) || lName.includes(term) || email.includes(term);
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Trainer Applications</h1>
          <p className="text-sm text-zinc-500">Review and manage professional certifications</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email..." className="pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-300 w-full md:w-64 focus:outline-none focus:border-green-500" />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {Object.entries({ all: "All", SUBMITTED: "New", UNDER_REVIEW: "Reviewing", NEEDS_MORE_INFO: "Needs Info", APPROVED: "Approved", REJECTED: "Rejected" }).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k as any)}
            className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === k ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700"
              }`}>
            {v}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 border-dashed rounded-2xl py-20 text-center">
          <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-600 text-sm">No applications found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(app => (
            <button key={app.id} onClick={() => setSelected(app)}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-left hover:border-green-500/30 transition-all group relative overflow-hidden">
              <div className="flex items-start justify-between relative z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-sm font-bold text-zinc-400 group-hover:text-green-400 transition-colors">
                    {app.user?.firstName?.[0]}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-200">{app.user?.firstName} {app.user?.lastName}</h3>
                    <p className="text-xs text-zinc-500">{app.user?.email}</p>
                  </div>
                </div>
                <div className={`w-2 h-2 rounded-full ${statusConfig[app.status || "DRAFT"].dot}`} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 relative z-10">
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <Briefcase className="w-3 h-3" /> {app.yearsOfExperience}y Exp
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <Calendar className="w-3 h-3" /> {new Date(app.createdAt).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <Award className="w-3 h-3" /> {app.certificates?.length || 0} Certs
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <ImageIcon className="w-3 h-3" /> {app.media?.length || 0} Media
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between relative z-10">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold bg-zinc-800 border border-zinc-700 ${statusConfig[app.status || "DRAFT"].text}`}>
                  {statusConfig[app.status || "DRAFT"].label}
                </span>
                <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-green-400 group-hover:translate-x-1 transition-all" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}