import { useState } from "react";
import {
  Check, X, Award, Zap, Search, ChevronRight,
  Shield, Briefcase, Users, Calendar, Globe, AlertCircle,
  Clock, Eye, FileText, MessageSquare, CheckCircle, XCircle,
  ArrowLeft, Phone, MapPin, Instagram, Linkedin, Youtube,
  RefreshCw, Image as ImageIcon
} from "lucide-react";

/* ── Status config ──────────────────────────────────────── */
type AppStatus = "submitted" | "under_review" | "info_required" | "approved" | "rejected";

const statusConfig: Record<AppStatus, { label: string; bg: string; text: string; border: string; dot: string }> = {
  submitted:     { label: "Submitted",       bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/20",   dot: "bg-blue-500"   },
  under_review:  { label: "Under Review",    bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20",  dot: "bg-amber-500"  },
  info_required: { label: "Info Required",   bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", dot: "bg-orange-500" },
  approved:      { label: "Approved",        bg: "bg-green-500/10",  text: "text-green-400",  border: "border-green-500/20",  dot: "bg-green-500"  },
  rejected:      { label: "Rejected",        bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/20",    dot: "bg-red-500"    },
};

/* ── Full mock data — mirrors all 8 PT application steps ── */
const applications = [
  {
    id: 1,
    /* Step 1 */
    name: "Emma Wilson", avatar: "EW", email: "emma@example.com",
    dob: "Aug 14, 1993", gender: "Female", phone: "+66 81 111 2222",
    address: "45 Ari Rd, Phaya Thai, Bangkok 10400", nationality: "Thai",
    /* Step 2 */
    nationalId: "3 4567 89012 34 5", passportNo: "",
    idFrontUploaded: true, idBackUploaded: false, portraitUploaded: false,
    /* Step 3 */
    experience: "3–5 years", educationLevel: "Bachelor's Degree",
    education: "Bachelor's in Physical Education, Thammasat University",
    workHistory: "PT at Virgin Active Bangkok (2021–2023), freelance yoga coach (2023–present).",
    specialties: ["Yoga", "Women's Health", "Flexibility & Mobility"],
    bio: "Certified yoga and wellness coach specialising in postnatal fitness and office worker health. My approach combines functional movement with mindful practice to help clients achieve sustainable results.",
    /* Step 4 */
    certs: [
      { name: "ACE CPT", org: "ACE", issueDate: "Mar 2021", expiry: "Dec 2026", status: "Valid" },
      { name: "RYT 200", org: "Yoga Alliance", issueDate: "Jun 2022", expiry: "Lifetime", status: "Valid" },
    ],
    certFiles: true,
    /* Step 5 */
    targets: ["Postpartum women", "Office workers", "Beginners"],
    trainingGoals: ["Fat Loss & Body Recomposition", "General Fitness & Health"],
    trainingApproach: "Blending mindful movement with evidence-based exercise science.",
    /* Step 6 */
    mode: "Hybrid", availDays: ["Mon", "Wed", "Thu", "Sat", "Sun"],
    availFrom: "07:00", availUntil: "19:00",
    area: "Ari / Phaya Thai, Bangkok", gym: "Freelance + Home Studio",
    pricePerSession: "฿700", pricePackage: "฿6,000 (10 sessions)", priceMonthly: "฿3,500",
    pricingNotes: "Trial session ฿400. Corporate wellness packages available.",
    /* Step 7 */
    instagram: "@emma_yoga_fit", facebook: "facebook.com/emmawellness",
    tiktok: "@emmayogafit", youtube: "", linkedin: "linkedin.com/in/emmawilson",
    website: "www.emmawellness.co.th", portfolioUploaded: true,
    otherLinks: "Featured in Women's Health Thailand, Jan 2025.",
    /* Admin */
    submitted: "Jun 17, 2025", status: "submitted" as AppStatus,
    completeness: 72, flags: ["Citizen ID back side missing", "Portrait photo missing"],
    idUploaded: false, adminNote: "",
  },
  {
    id: 2,
    name: "Luke Hansen", avatar: "LH", email: "luke@example.com",
    dob: "Feb 3, 1989", gender: "Male", phone: "+66 89 333 4444",
    address: "89 Phromphong, Sukhumvit, Bangkok 10110", nationality: "Danish / Thai PR",
    nationalId: "1 2345 67890 12 3", passportNo: "DN123456",
    idFrontUploaded: true, idBackUploaded: true, portraitUploaded: true,
    experience: "5–10 years", educationLevel: "Master's Degree",
    education: "MSc Exercise Science, Mahidol University",
    workHistory: "Head S&C coach, Thai national football team (2019–2022). Senior PT, Fitness Lab Bangkok (2022–present).",
    specialties: ["Sports Performance", "Powerlifting", "Strength Training"],
    bio: "Strength and conditioning specialist with 7 years working with elite athletes and competitive powerlifters. I focus on evidence-based programming and periodisation to drive peak performance.",
    certs: [
      { name: "CSCS", org: "NSCA", issueDate: "Jan 2018", expiry: "Dec 2027", status: "Valid" },
    ],
    certFiles: true,
    targets: ["Athletes", "Advanced trainees", "Competitive bodybuilders"],
    trainingGoals: ["Muscle Building & Hypertrophy", "Strength & Powerlifting", "Sports Performance"],
    trainingApproach: "Periodised programs tailored to competition cycles. Emphasis on biomechanics and injury prevention.",
    mode: "Offline", availDays: ["Tue", "Wed", "Thu", "Fri", "Sat"],
    availFrom: "06:00", availUntil: "20:00",
    area: "Sukhumvit, Bangkok", gym: "Fitness Lab Bangkok, Asok Branch",
    pricePerSession: "฿1,200", pricePackage: "฿10,000 (10 sessions)", priceMonthly: "฿5,500",
    pricingNotes: "Performance assessment session: ฿800.",
    instagram: "@lukehansen_strength", facebook: "",
    tiktok: "", youtube: "youtube.com/@lukehansen",
    linkedin: "linkedin.com/in/lukehansen", website: "www.lukehansen.fitness",
    portfolioUploaded: false, otherLinks: "",
    submitted: "Jun 16, 2025", status: "under_review" as AppStatus,
    completeness: 98, flags: [],
    idUploaded: true, adminNote: "Strong application. Checking cert authenticity with NSCA.",
  },
  {
    id: 3,
    name: "Priya Singh", avatar: "PS", email: "priya@example.com",
    dob: "Nov 22, 1998", gender: "Female", phone: "+66 62 555 6666",
    address: "12 Onnut, Prawet, Bangkok 10260", nationality: "Thai",
    nationalId: "", passportNo: "",
    idFrontUploaded: false, idBackUploaded: false, portraitUploaded: false,
    experience: "1–2 years", educationLevel: "Diploma / Vocational",
    education: "Diploma in Sports Nutrition",
    workHistory: "Part-time online nutrition coach (2024–present).",
    specialties: ["Nutrition", "Weight Loss", "Fat Loss"],
    bio: "I love fitness.",
    certs: [],
    certFiles: false,
    targets: ["Weight-loss clients", "Beginners", "Office workers"],
    trainingGoals: ["Fat Loss & Body Recomposition"],
    trainingApproach: "",
    mode: "Online", availDays: ["Mon", "Tue", "Wed"],
    availFrom: "10:00", availUntil: "18:00",
    area: "Online (Thailand-wide)", gym: "N/A – Online only",
    pricePerSession: "฿500", pricePackage: "", priceMonthly: "฿2,500",
    pricingNotes: "",
    instagram: "", facebook: "", tiktok: "", youtube: "", linkedin: "", website: "",
    portfolioUploaded: false, otherLinks: "",
    submitted: "Jun 10, 2025", status: "info_required" as AppStatus,
    completeness: 54,
    flags: ["No certifications uploaded", "No portrait photo", "Citizen ID photos missing", "National ID not entered", "Bio too short"],
    idUploaded: false, adminNote: "Missing critical documents. Sent request for cert + ID photo.",
  },
  {
    id: 4,
    name: "Sarah Mitchell", avatar: "SM", email: "sarah.pt@example.com",
    dob: "May 7, 1990", gender: "Female", phone: "+66 81 777 8888",
    address: "200 Silom, Bang Rak, Bangkok 10500", nationality: "Thai",
    nationalId: "5 6789 01234 56 7", passportNo: "",
    idFrontUploaded: true, idBackUploaded: true, portraitUploaded: true,
    experience: "5–10 years", educationLevel: "Bachelor's Degree",
    education: "Bachelor's in Sports Science, Chulalongkorn University",
    workHistory: "Senior PT, Fitness First Silom (2018–2022). Head trainer, Body Lab Bangkok (2022–present).",
    specialties: ["Fat Loss", "Strength Training", "Bodybuilding"],
    bio: "NASM-certified personal trainer with 6 years of experience transforming clients through science-backed fat loss and muscle building protocols. Specialising in sustainable lifestyle change.",
    certs: [
      { name: "NASM CPT", org: "NASM", issueDate: "Dec 2018", expiry: "Dec 2025", status: "Valid" },
      { name: "PN Level 1", org: "Precision Nutrition", issueDate: "Jun 2020", expiry: "Lifetime", status: "Valid" },
    ],
    certFiles: true,
    targets: ["Beginners", "Weight-loss clients", "Advanced trainees"],
    trainingGoals: ["Fat Loss & Body Recomposition", "Muscle Building & Hypertrophy", "General Fitness & Health"],
    trainingApproach: "Science-backed periodised programs. Nutrition coaching integrated into every plan.",
    mode: "Hybrid", availDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    availFrom: "06:00", availUntil: "21:00",
    area: "Silom / Sathon, Bangkok", gym: "Body Lab Bangkok, Silom",
    pricePerSession: "฿1,000", pricePackage: "฿8,500 (10 sessions)", priceMonthly: "฿4,500",
    pricingNotes: "Free intro call. Corporate rates on request.",
    instagram: "@sarahmitchell_fit", facebook: "facebook.com/sarahmitchell.coach",
    tiktok: "@sarahfitbkk", youtube: "youtube.com/@sarahfit",
    linkedin: "linkedin.com/in/sarahmitchell", website: "www.sarahmitchell.fit",
    portfolioUploaded: true, otherLinks: "Runner-up, Bangkok Women's Fitness Competition 2023.",
    submitted: "Dec 1, 2024", status: "approved" as AppStatus,
    completeness: 100, flags: [],
    idUploaded: true, adminNote: "Approved. Top-quality application with full documentation.",
  },
  {
    id: 5,
    name: "James Kwan", avatar: "JK", email: "james.pt@example.com",
    dob: "Sep 19, 1985", gender: "Male", phone: "+66 83 999 0000",
    address: "5 Asok, Watthana, Bangkok 10110", nationality: "Thai",
    nationalId: "4 5678 90123 45 6", passportNo: "",
    idFrontUploaded: true, idBackUploaded: true, portraitUploaded: true,
    experience: "10+ years", educationLevel: "Bachelor's Degree",
    education: "Bachelor's in Physical Education",
    workHistory: "Independent PT and bodybuilding coach for 10+ years.",
    specialties: ["Bodybuilding", "Powerlifting", "Muscle Gain"],
    bio: "Experienced bodybuilding coach with over 10 years in competitive training and coaching.",
    certs: [
      { name: "ISSA CPT", org: "ISSA", issueDate: "Mar 2014", expiry: "Mar 2022", status: "Expired" },
    ],
    certFiles: true,
    targets: ["Advanced trainees", "Athletes", "Competitive bodybuilders"],
    trainingGoals: ["Muscle Building & Hypertrophy", "Strength & Powerlifting"],
    trainingApproach: "Competition prep and off-season hypertrophy. Macro-based nutrition integration.",
    mode: "Offline", availDays: ["Mon", "Wed", "Fri", "Sat"],
    availFrom: "07:00", availUntil: "19:00",
    area: "Asok / Phrom Phong", gym: "Iron House Gym, Asok",
    pricePerSession: "฿1,500", pricePackage: "฿12,000 (10 sessions)", priceMonthly: "฿6,000",
    pricingNotes: "",
    instagram: "@jameskwan_bb", facebook: "", tiktok: "", youtube: "", linkedin: "", website: "",
    portfolioUploaded: false, otherLinks: "",
    submitted: "Nov 10, 2024", status: "rejected" as AppStatus,
    completeness: 76,
    flags: ["Cert expiry inconsistency"],
    idUploaded: true, adminNote: "Rejected due to inconsistent cert details. Applicant may reapply with corrected documentation.",
  },
];

type App = typeof applications[0];
type FilterKey = "all" | AppStatus;

/* ── InfoRow component (kept exactly as before) ─────────── */
function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-3 text-sm py-1.5 border-b border-zinc-800/40 last:border-0">
      <span className="text-zinc-500 w-36 flex-shrink-0 text-xs mt-0.5">{label}</span>
      <span className={`${highlight ? "text-green-400 font-semibold" : "text-zinc-300"} font-medium text-xs`}>{value || "—"}</span>
    </div>
  );
}

/* ── Document thumbnail ─────────────────────────────────── */
function DocThumb({ label, uploaded, tag }: { label: string; uploaded: boolean; tag?: string }) {
  return (
    <div className={`rounded-xl overflow-hidden border-2 transition-all ${uploaded ? "border-green-500/30" : "border-red-500/20"}`}>
      <div className={`h-32 flex items-center justify-center relative ${uploaded ? "bg-zinc-800/60" : "bg-red-500/5"}`}>
        {uploaded ? (
          <>
            <div className="absolute inset-0 opacity-5"
              style={{ backgroundImage: "repeating-linear-gradient(0deg,#22c55e,#22c55e 1px,transparent 1px,transparent 18px),repeating-linear-gradient(90deg,#22c55e,#22c55e 1px,transparent 1px,transparent 18px)" }} />
            <div className="relative z-10 text-center">
              <ImageIcon className="w-7 h-7 text-green-400 mx-auto mb-1 opacity-70" />
              <p className="text-xs text-zinc-400">Preview</p>
            </div>
            {tag && <span className="absolute top-2 right-2 text-xs bg-zinc-900/80 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-md font-semibold">{tag}</span>}
          </>
        ) : (
          <div className="text-center">
            <XCircle className="w-7 h-7 text-red-400/60 mx-auto mb-1" />
            <p className="text-xs text-red-400">Not uploaded</p>
          </div>
        )}
      </div>
      <div className={`px-3 py-2 flex items-center justify-between ${uploaded ? "bg-zinc-900" : "bg-red-500/5"}`}>
        <span className="text-xs font-semibold text-zinc-300 truncate">{label}</span>
        {uploaded ? <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DOCUMENT VIEWER MODAL
═══════════════════════════════════════════════════════════ */
function DocumentViewer({ app, onClose }: { app: App; onClose: () => void }) {
  const [section, setSection] = useState<1|2|3>(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.85)" }}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-lg flex items-center justify-center text-xs font-bold text-green-400">
              {app.avatar}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100">Document Review — {app.name}</h3>
              <p className="text-xs text-zinc-500">Submitted {app.submitted}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-zinc-800/60 bg-zinc-900/60">
          {([
            { key: 1 as const, label: "Identity Verification",      icon: Shield    },
            { key: 2 as const, label: "Pro Certificates",           icon: Award     },
            { key: 3 as const, label: "Portfolio / Before & After", icon: ImageIcon },
          ]).map(t => (
            <button key={t.key} onClick={() => setSection(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-bold border-b-2 transition-all min-w-0 ${
                section === t.key
                  ? "border-green-500 text-green-400 bg-green-500/8"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}>
              <t.icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">§{t.key} – {t.label}</span>
            </button>
          ))}
        </div>

        {/* Section body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* ── Section 1: Identity Verification ── */}
          {section === 1 && (
            <>
              <div className="flex items-start gap-3 bg-blue-500/8 border border-blue-500/20 rounded-xl px-4 py-3">
                <Shield className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-blue-300 mb-0.5">Section 1 — Identity Verification</p>
                  <p className="text-xs text-blue-300/70">3 required documents: Citizen ID front, Citizen ID back, and portrait photo.</p>
                </div>
              </div>

              {/* Declared ID number */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Declared Citizen ID Number</p>
                <p className={`text-base font-mono tracking-widest font-bold ${app.nationalId ? "text-green-400" : "text-red-400 italic"}`}>
                  {app.nationalId || "Not provided"}
                </p>
                {app.passportNo && <p className="text-xs text-zinc-500 mt-1">Passport: <span className="font-mono text-zinc-300">{app.passportNo}</span></p>}
              </div>

              {/* 3 document slots */}
              <div className="grid grid-cols-3 gap-3">
                <DocThumb label="Citizen ID — Front" uploaded={app.idFrontUploaded} tag="Front" />
                <DocThumb label="Citizen ID — Back"  uploaded={app.idBackUploaded}  tag="Back"  />
                <DocThumb label="Portrait Photo"      uploaded={app.portraitUploaded} tag="Portrait" />
              </div>

              {(!app.idFrontUploaded || !app.idBackUploaded || !app.portraitUploaded) ? (
                <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  One or more identity documents are missing. Cannot approve until all 3 documents are uploaded.
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-3 text-xs text-green-300">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  All 3 identity documents uploaded. Please verify against the declared ID number above.
                </div>
              )}
            </>
          )}

          {/* ── Section 2: Certificates ── */}
          {section === 2 && (
            <>
              <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
                <Award className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-amber-300 mb-0.5">Section 2 — Professional Certificates</p>
                  <p className="text-xs text-amber-300/70">Verify certificate authenticity, issuing organization, and expiry status.</p>
                </div>
              </div>

              {app.certs.length === 0 ? (
                <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-8 text-center">
                  <XCircle className="w-10 h-10 text-red-400/60 mx-auto mb-2" />
                  <p className="text-sm font-bold text-red-400 mb-1">No Certifications Provided</p>
                  <p className="text-xs text-red-300/70">The applicant has not submitted any certification details or files. Required for approval.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {app.certs.map((c, i) => (
                    <div key={i} className={`bg-zinc-900 rounded-xl border overflow-hidden ${c.status === "Expired" ? "border-red-500/30" : "border-zinc-800/60"}`}>
                      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800/30 border-b border-zinc-800/60">
                        <div className="flex items-center gap-2">
                          <Award className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-sm font-bold text-zinc-200">{c.name}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${
                          c.status === "Valid" ? "bg-green-500/10 text-green-400 border-green-500/20"
                                              : "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}>{c.status}</span>
                      </div>
                      <div className="px-4 py-3 grid grid-cols-3 gap-3 text-xs">
                        <div><p className="text-zinc-600 mb-0.5">Issued By</p><p className="text-zinc-300 font-semibold">{c.org}</p></div>
                        <div><p className="text-zinc-600 mb-0.5">Issue Date</p><p className="text-zinc-300 font-semibold">{c.issueDate}</p></div>
                        <div><p className="text-zinc-600 mb-0.5">Expiry</p><p className={`font-semibold ${c.status === "Expired" ? "text-red-400" : "text-zinc-300"}`}>{c.expiry}</p></div>
                      </div>
                      {c.status === "Expired" && (
                        <div className="mx-4 mb-3 flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-300">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          This certificate is expired. Applicant must submit a current cert before approval.
                        </div>
                      )}
                    </div>
                  ))}

                  <div>
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Certificate Files</p>
                    {app.certFiles ? (
                      <div className="grid grid-cols-2 gap-3">
                        {app.certs.map((c, i) => (
                          <DocThumb key={i} label={`${c.org} — ${c.name}`} uploaded={true} tag={c.status} />
                        ))}
                      </div>
                    ) : (
                      <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-6 text-center">
                        <XCircle className="w-8 h-8 text-red-400/60 mx-auto mb-1" />
                        <p className="text-xs text-red-400 font-semibold">No certificate files uploaded</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Section 3: Portfolio ── */}
          {section === 3 && (
            <>
              <div className="flex items-start gap-3 bg-violet-500/8 border border-violet-500/20 rounded-xl px-4 py-3">
                <ImageIcon className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-violet-300 mb-0.5">Section 3 — Portfolio & Before/After (Optional)</p>
                  <p className="text-xs text-violet-300/70">Optional: portfolio images, client transformations, and professional showcase visuals.</p>
                </div>
              </div>

              {app.portfolioUploaded ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <DocThumb label="Portfolio Image 1"    uploaded={true}  tag="Portfolio" />
                    <DocThumb label="Portfolio Image 2"    uploaded={true}  tag="Portfolio" />
                    <DocThumb label="Before / After"       uploaded={true}  tag="Transformation" />
                  </div>
                  {app.otherLinks && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Other Links & References</p>
                      <p className="text-sm text-zinc-300">{app.otherLinks}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center">
                  <ImageIcon className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-zinc-400 mb-1">No Portfolio Uploaded</p>
                  <p className="text-xs text-zinc-600">This section is optional. The applicant did not submit portfolio images.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer nav dots */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/60">
          <div className="flex gap-1.5">
            {[1,2,3].map(n => (
              <button key={n} onClick={() => setSection(n as 1|2|3)}
                className={`w-2 h-2 rounded-full transition-all ${section===n?"bg-green-500":"bg-zinc-700"}`} />
            ))}
          </div>
          <button onClick={onClose} className="px-4 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-xs font-semibold rounded-lg hover:bg-zinc-700 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DETAIL VIEW — keeps the exact same structure, adds missing fields
═══════════════════════════════════════════════════════════ */
function DetailView({ app, onBack }: { app: App; onBack: () => void }) {
  const [adminNote,  setAdminNote]  = useState(app.adminNote);
  const [feedback,   setFeedback]   = useState("");
  const [actionDone, setActionDone] = useState<string | null>(null);
  const [showDocs,   setShowDocs]   = useState(false);
  const cfg = statusConfig[app.status];

  return (
    <>
      {showDocs && <DocumentViewer app={app} onClose={() => setShowDocs(false)} />}

      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-zinc-100">PT Application Review</h1>
            <p className="text-zinc-500 text-sm mt-0.5">Submitted {app.submitted}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          </div>
        </div>

        {/* Flags */}
        {app.flags.length > 0 && (
          <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-red-400">
              <AlertCircle className="w-4 h-4" /> {app.flags.length} Issue{app.flags.length > 1 ? "s" : ""} Found
            </div>
            <ul className="space-y-1">
              {app.flags.map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-red-300">
                  <XCircle className="w-3 h-3 flex-shrink-0" /> {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {actionDone && (
          <div className="bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-green-300">
            <CheckCircle className="w-4 h-4" /> {actionDone}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* ── Left sidebar (same structure as before, expanded) ── */}
          <div className="space-y-4">

            {/* Identity card */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 text-center">
              <div className="w-20 h-20 bg-green-500/15 border border-green-500/20 rounded-2xl flex items-center justify-center text-xl font-bold text-green-400 mx-auto mb-3">
                {app.avatar}
              </div>
              <h3 className="text-zinc-100 font-bold">{app.name}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{app.email}</p>

              {/* Completeness bar */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Completeness</span>
                  <span className={`font-bold ${app.completeness >= 90 ? "text-green-400" : app.completeness >= 70 ? "text-amber-400" : "text-red-400"}`}>
                    {app.completeness}%
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${app.completeness >= 90 ? "bg-green-500" : app.completeness >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${app.completeness}%` }} />
                </div>
              </div>

              {/* Document verification badges — now 5 specific items */}
              <div className="mt-4 space-y-2">
                {[
                  { label: "Citizen ID Front",  ok: app.idFrontUploaded  },
                  { label: "Citizen ID Back",   ok: app.idBackUploaded   },
                  { label: "Portrait Photo",    ok: app.portraitUploaded },
                  { label: "Cert Files",        ok: app.certFiles        },
                  { label: "Certifications",    ok: app.certs.length > 0, extra: `${app.certs.length} cert${app.certs.length !== 1 ? "s" : ""}` },
                ].map(d => (
                  <div key={d.label} className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    d.ok ? "bg-green-500/10 text-green-400 border border-green-500/20"
                         : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}>
                    <span>{d.label}</span>
                    {d.ok
                      ? <span className="flex items-center gap-1">{d.extra && <span className="mr-1">{d.extra}</span>}<CheckCircle className="w-3.5 h-3.5" /></span>
                      : <XCircle className="w-3.5 h-3.5" />}
                  </div>
                ))}

                {/* View Documents button */}
                <button
                  onClick={() => setShowDocs(true)}
                  className="mt-1 w-full flex items-center justify-center gap-2 py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold rounded-xl transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> View Documents
                </button>
              </div>
            </div>

            {/* Contact & Location */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Contact & Location</p>
              <div className="flex items-start gap-2 text-xs text-zinc-400">
                <Phone className="w-3.5 h-3.5 text-zinc-600 mt-0.5 flex-shrink-0" /> {app.phone}
              </div>
              <div className="flex items-start gap-2 text-xs text-zinc-400">
                <MapPin className="w-3.5 h-3.5 text-zinc-600 mt-0.5 flex-shrink-0" /> {app.address}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Shield className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                ID: <span className={`font-mono ${app.nationalId ? "text-green-400" : "text-red-400 italic"}`}>{app.nationalId || "Not provided"}</span>
              </div>
            </div>

            {/* Social & Portfolio */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Social & Portfolio</p>
              {app.instagram && <div className="flex items-center gap-2 text-xs text-zinc-400"><Instagram className="w-3.5 h-3.5 text-rose-400" /> {app.instagram}</div>}
              {app.linkedin  && <div className="flex items-center gap-2 text-xs text-zinc-400"><Linkedin  className="w-3.5 h-3.5 text-blue-400" /> {app.linkedin}</div>}
              {app.youtube   && <div className="flex items-center gap-2 text-xs text-zinc-400"><Youtube   className="w-3.5 h-3.5 text-red-400"  /> {app.youtube}</div>}
              {app.facebook  && <div className="flex items-center gap-2 text-xs text-zinc-400"><Globe     className="w-3.5 h-3.5 text-blue-300" /> {app.facebook}</div>}
              {app.tiktok    && <div className="flex items-center gap-2 text-xs text-zinc-400"><Globe     className="w-3.5 h-3.5 text-zinc-400" /> {app.tiktok}</div>}
              {app.website   && <div className="flex items-center gap-2 text-xs text-zinc-400"><Globe     className="w-3.5 h-3.5 text-zinc-400" /> {app.website}</div>}
              {!app.instagram && !app.linkedin && !app.youtube && !app.facebook && !app.tiktok && !app.website && (
                <p className="text-xs text-zinc-600 italic">No social links provided</p>
              )}
              {app.portfolioUploaded && (
                <button onClick={() => setShowDocs(true)} className="mt-1 text-xs text-green-400 hover:text-green-300 underline underline-offset-2 transition-colors flex items-center gap-1">
                  <Eye className="w-3 h-3" /> View portfolio images
                </button>
              )}
            </div>
          </div>

          {/* ── Right: Full detail (keeping same structure, adding fields) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Step 1 – Personal Info */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-green-400" /> Personal Information
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                <div>
                  <InfoRow label="Full Name"   value={app.name}        />
                  <InfoRow label="Date of Birth" value={app.dob}       />
                  <InfoRow label="Gender"      value={app.gender}      />
                  <InfoRow label="Nationality" value={app.nationality} />
                </div>
                <div>
                  <InfoRow label="Phone"   value={app.phone}   />
                  <InfoRow label="Email"   value={app.email}   />
                  <InfoRow label="Address" value={app.address} />
                </div>
              </div>
            </div>

            {/* Bio */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Professional Bio</p>
              <p className={`text-sm leading-relaxed ${app.bio.length < 100 ? "text-amber-400" : "text-zinc-300"}`}>
                {app.bio}
                {app.bio.length < 100 && <span className="ml-2 text-xs text-amber-500 font-bold">(⚠ too short)</span>}
              </p>
            </div>

            {/* Professional background (same card, added work history + availability fields) */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5" /> Professional Background
              </p>
              <InfoRow label="Experience"          value={app.experience}      />
              <InfoRow label="Education Level"     value={app.educationLevel}  />
              <InfoRow label="Education"           value={app.education}       />
              <InfoRow label="Work History"        value={app.workHistory}     />
              <InfoRow label="Working Mode"        value={app.mode}            highlight />
              <InfoRow label="Service Area"        value={app.area}            />
              <InfoRow label="Gym / Facility"      value={app.gym}             />
              <InfoRow label="Available Days"      value={app.availDays.join(", ")} />
              <InfoRow label="Available Hours"     value={`${app.availFrom} – ${app.availUntil}`} />
              <InfoRow label="Price / Session"     value={app.pricePerSession} highlight />
              <InfoRow label="Package (10×)"       value={app.pricePackage}    />
              <InfoRow label="Monthly Program"     value={app.priceMonthly}    />
              {app.pricingNotes && <InfoRow label="Pricing Notes" value={app.pricingNotes} />}
              <div className="pt-2">
                <p className="text-xs text-zinc-600 mb-2">Specialties</p>
                <div className="flex flex-wrap gap-1.5">
                  {app.specialties.map(s => (
                    <span key={s} className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/50 px-2 py-0.5 rounded-full">{s}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Target clients */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Target Clients & Training Goals
              </p>
              <div className="mb-3">
                <p className="text-xs text-zinc-600 mb-2">Target Client Groups</p>
                <div className="flex flex-wrap gap-1.5">
                  {app.targets.map(t => (
                    <span key={t} className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>
              {app.trainingGoals.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-zinc-600 mb-2">Training Goals Offered</p>
                  <div className="flex flex-wrap gap-1.5">
                    {app.trainingGoals.map(g => (
                      <span key={g} className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/50 px-2 py-0.5 rounded-full">{g}</span>
                    ))}
                  </div>
                </div>
              )}
              {app.trainingApproach && (
                <div>
                  <p className="text-xs text-zinc-600 mb-1">Training Approach</p>
                  <p className="text-xs text-zinc-400 leading-relaxed">{app.trainingApproach}</p>
                </div>
              )}
            </div>

            {/* Certifications */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Award className="w-3.5 h-3.5" /> Certifications
              </p>
              {app.certs.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
                  <XCircle className="w-3.5 h-3.5" /> No certifications provided — required for approval
                </div>
              ) : (
                <div className="space-y-3">
                  {app.certs.map((c, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-zinc-800/40 border border-zinc-700/40 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Award className="w-4 h-4 text-amber-400" />
                        <div>
                          <div className="text-sm font-semibold text-zinc-200">{c.name}</div>
                          <div className="text-xs text-zinc-500">{c.org} · Issued: {c.issueDate} · Expires: {c.expiry}</div>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${
                        c.status === "Valid" ? "bg-green-500/10 text-green-400 border-green-500/20"
                                            : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}>{c.status}</span>
                    </div>
                  ))}
                  {app.certFiles && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <FileText className="w-3.5 h-3.5 text-green-400" />
                      Certificate files uploaded —
                      <button onClick={() => setShowDocs(true)} className="text-green-400 hover:text-green-300 underline">View documents</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Admin internal note */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5" /> Internal Admin Note
              </p>
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                rows={3}
                placeholder="Add internal notes visible only to admins…"
                className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/30 placeholder-zinc-600 resize-none"
              />
              <div className="flex justify-end mt-2">
                <button className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-lg hover:bg-green-500/20 transition-colors font-semibold">
                  Save Note
                </button>
              </div>
            </div>

            {/* Feedback to applicant */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-orange-400" /> Feedback to Applicant
              </p>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                rows={3}
                placeholder="Send a message to the applicant — visible in their application status page…"
                className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-orange-500/30 placeholder-zinc-600 resize-none"
              />
            </div>

            {/* Admin actions */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Admin Actions</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setActionDone("Application approved. Applicant notified.")}
                  className="flex items-center justify-center gap-2 py-2.5 bg-green-500 text-black text-sm font-bold rounded-xl hover:bg-green-400 transition-all shadow-lg shadow-green-500/15">
                  <Check className="w-4 h-4" /> Approve
                </button>
                <button onClick={() => setActionDone("Application marked as Under Review.")}
                  className="flex items-center justify-center gap-2 py-2.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 text-sm font-semibold rounded-xl hover:bg-amber-500/20 transition-colors">
                  <RefreshCw className="w-4 h-4" /> Mark Under Review
                </button>
                <button onClick={() => setActionDone("Additional info requested. Applicant notified.")}
                  className="flex items-center justify-center gap-2 py-2.5 bg-orange-500/10 text-orange-400 border border-orange-500/30 text-sm font-semibold rounded-xl hover:bg-orange-500/20 transition-colors">
                  <MessageSquare className="w-4 h-4" /> Request More Info
                </button>
                <button onClick={() => setActionDone("Application rejected. Feedback sent to applicant.")}
                  className="flex items-center justify-center gap-2 py-2.5 bg-red-500/10 text-red-400 border border-red-500/30 text-sm font-semibold rounded-xl hover:bg-red-500/20 transition-colors">
                  <X className="w-4 h-4" /> Reject Application
                </button>
              </div>
              <p className="text-xs text-zinc-600 text-center mt-3">
                Actions send automatic notifications to the applicant. Add feedback above before rejecting.
              </p>
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
  const [filter,   setFilter]   = useState<FilterKey>("all");
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState<App | null>(null);

  if (selected) {
    return <DetailView app={selected} onBack={() => setSelected(null)} />;
  }

  const filterTabs: { key: FilterKey; label: string }[] = [
    { key: "all",          label: `All (${applications.length})`                                              },
    { key: "submitted",    label: `New (${applications.filter(a => a.status === "submitted").length})`        },
    { key: "under_review", label: `Under Review (${applications.filter(a => a.status === "under_review").length})` },
    { key: "info_required",label: `Info Required (${applications.filter(a => a.status === "info_required").length})` },
    { key: "approved",     label: `Approved (${applications.filter(a => a.status === "approved").length})`   },
    { key: "rejected",     label: `Rejected (${applications.filter(a => a.status === "rejected").length})`   },
  ];

  const filtered = applications.filter(a => {
    const matchFilter = filter === "all" || a.status === filter;
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
                        a.email.toLowerCase().includes(search.toLowerCase()) ||
                        a.specialties.some(s => s.toLowerCase().includes(search.toLowerCase()));
    return matchFilter && matchSearch;
  });

  const pending = applications.filter(a => ["submitted","under_review","info_required"].includes(a.status)).length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">PT Application Management</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{applications.length} total applications · {pending} requiring action</p>
        </div>
        {pending > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-full border border-amber-500/20 w-fit">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {pending} awaiting review
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or specialty…"
          className="w-full pl-9 pr-4 py-2.5 bg-zinc-900 border border-zinc-800/60 rounded-xl text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/40"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800/60 p-1 rounded-xl overflow-x-auto">
        {filterTabs.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              filter === t.key ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Application list */}
      <div className="space-y-3">
        {filtered.map(app => {
          const cfg = statusConfig[app.status];
          return (
            <div key={app.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800/60 hover:border-zinc-700/80 p-4 transition-all cursor-pointer group"
              onClick={() => setSelected(app)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center text-sm font-bold text-green-400 flex-shrink-0">
                    {app.avatar}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-zinc-200">{app.name}</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">{app.email} · {app.phone}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-zinc-500 sm:ml-2">
                  <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {app.experience}</span>
                  <span className="flex items-center gap-1"><Calendar  className="w-3 h-3" /> {app.submitted}</span>
                  <span className="flex items-center gap-1"><Award     className="w-3 h-3" /> {app.certs.length} cert{app.certs.length !== 1 ? "s" : ""}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                  {app.specialties.slice(0, 2).map(s => (
                    <span key={s} className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700/50 px-1.5 py-0.5 rounded-full">{s}</span>
                  ))}
                  {app.specialties.length > 2 && <span className="text-xs text-zinc-600">+{app.specialties.length - 2}</span>}
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <div className={`text-xs font-bold ${app.completeness >= 90 ? "text-green-400" : app.completeness >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {app.completeness}%
                    </div>
                    <div className="text-xs text-zinc-600">complete</div>
                  </div>
                  {app.flags.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-full">
                      <AlertCircle className="w-3 h-3" /> {app.flags.length} flag{app.flags.length > 1 ? "s" : ""}
                    </div>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-green-400 transition-colors" />
                </div>
              </div>

              {(app.status === "submitted" || app.status === "under_review") && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-800/40" onClick={e => e.stopPropagation()}>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/15 text-green-400 border border-green-500/30 text-xs font-bold rounded-lg hover:bg-green-500/25 transition-colors">
                    <Check className="w-3 h-3" /> Approve
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold rounded-lg hover:bg-amber-500/20 transition-colors">
                    <RefreshCw className="w-3 h-3" /> Mark Under Review
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-semibold rounded-lg hover:bg-orange-500/20 transition-colors">
                    <MessageSquare className="w-3 h-3" /> Request Info
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold rounded-lg hover:bg-red-500/20 transition-colors">
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-16 text-center text-zinc-600 bg-zinc-900 rounded-xl border border-zinc-800/60">
            <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No applications match this filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}