import { useState } from "react";
import { useNavigate } from "react-router";
import {
  User, Shield, Briefcase, Award, Users, Calendar,
  Globe, CheckCircle, ChevronLeft, ChevronRight,
  Upload, X, Check, AlertCircle, Clock, Eye, FileText,
  Instagram, Youtube, Linkedin, ArrowLeft
} from "lucide-react";
import { useApp } from "../../context/AppContext";

const inp   = "w-full px-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 placeholder-zinc-600 transition-all";
const lbl   = "text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold";

const steps = [
  { key: "personal",     label: "Personal Info",           icon: User        },
  { key: "identity",     label: "Identity & Verification", icon: Shield      },
  { key: "experience",   label: "Professional Experience", icon: Briefcase   },
  { key: "certs",        label: "Certifications",          icon: Award       },
  { key: "focus",        label: "Coaching Focus",          icon: Users       },
  { key: "availability", label: "Service & Availability",  icon: Calendar    },
  { key: "portfolio",    label: "Portfolio & Social",      icon: Globe       },
  { key: "review",       label: "Review & Submit",         icon: CheckCircle },
];

const specialtyOptions = [
  "Muscle Gain","Fat Loss","Powerlifting","Bodybuilding","Calisthenics",
  "Yoga","Rehabilitation","Sports Nutrition","HIIT","Functional Training",
  "Endurance","Flexibility & Mobility","Sports Performance","Boxing & MMA",
];
const targetOptions = [
  "Beginners","Weight-loss clients","Postpartum women","Advanced trainees",
  "Office workers","Athletes","Rehab clients","Seniors","Teens / Youth","Competitive bodybuilders",
];

type AppStatus = "not_applied"|"draft"|"submitted"|"under_review"|"info_required"|"approved"|"rejected";

const appStatusConfig: Record<AppStatus,{label:string;bg:string;text:string;border:string;dot:string;desc:string}> = {
  not_applied:   { label:"Not Applied",            bg:"bg-zinc-700/50",    text:"text-zinc-400",   border:"border-zinc-700",      dot:"bg-zinc-500",   desc:"You have not applied yet." },
  draft:         { label:"Draft",                  bg:"bg-zinc-700/50",    text:"text-zinc-400",   border:"border-zinc-700",      dot:"bg-zinc-400",   desc:"Your application is saved as draft." },
  submitted:     { label:"Submitted",              bg:"bg-blue-500/10",    text:"text-blue-400",   border:"border-blue-500/20",   dot:"bg-blue-500",   desc:"Application submitted, awaiting admin review." },
  under_review:  { label:"Under Review",           bg:"bg-amber-500/10",   text:"text-amber-400",  border:"border-amber-500/20",  dot:"bg-amber-500",  desc:"Admin is reviewing your application." },
  info_required: { label:"Additional Info Needed", bg:"bg-orange-500/10",  text:"text-orange-400", border:"border-orange-500/20", dot:"bg-orange-500", desc:"Admin has requested more information." },
  approved:      { label:"Approved ✓",             bg:"bg-green-500/10",   text:"text-green-400",  border:"border-green-500/20",  dot:"bg-green-500",  desc:"Congratulations! Your PT application has been approved." },
  rejected:      { label:"Rejected",               bg:"bg-red-500/10",     text:"text-red-400",    border:"border-red-500/20",    dot:"bg-red-500",    desc:"Your application was not approved at this time." },
};

function Chip({ label, active, onClick }: { label:string; active:boolean; onClick:()=>void }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
        active ? "bg-green-500/15 text-green-400 border-green-500/40"
               : "bg-zinc-800 text-zinc-500 border-zinc-700/50 hover:border-zinc-600"
      }`}>
      {active && <Check className="w-3 h-3 inline mr-1" />}{label}
    </button>
  );
}

function UploadBox({ label: labelText, hint }: { label:string; hint?:string }) {
  const [uploaded, setUploaded] = useState(false);
  return (
    <div>
      <p className={lbl}>{labelText}</p>
      <div onClick={() => setUploaded(u => !u)}
        className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          uploaded ? "border-green-500/40 bg-green-500/5"
                   : "border-zinc-700 hover:border-green-500/40 hover:bg-zinc-800/40"
        }`}>
        {uploaded ? (
          <div className="flex items-center justify-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-semibold">File uploaded</span>
            <button onClick={e => { e.stopPropagation(); setUploaded(false); }} className="ml-2 text-zinc-600 hover:text-red-400">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div>
            <Upload className="w-6 h-6 text-zinc-600 mx-auto mb-1" />
            <p className="text-xs text-zinc-500">{hint || "Click to upload or drag & drop"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function PTApplicationPage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [submitted,   setSubmitted]   = useState(false);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [targets,     setTargets]     = useState<string[]>([]);
  const [mode,        setMode]        = useState<"online"|"offline"|"hybrid">("hybrid");
  const [days,        setDays]        = useState<string[]>([]);

  const toggle = (arr:string[], set:(a:string[])=>void, val:string) =>
    set(arr.includes(val) ? arr.filter(x=>x!==val) : [...arr, val]);

  const goNext = () => setCurrentStep(s => Math.min(s+1, steps.length-1));
  const goPrev = () => setCurrentStep(s => Math.max(s-1, 0));

  if (submitted) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="bg-zinc-900 rounded-xl border border-green-500/20 p-10 text-center">
          <div className="w-20 h-20 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-xl shadow-green-500/10">
            <CheckCircle className="w-10 h-10 text-green-400" />
          </div>
          <h2 className="text-zinc-100 font-bold mb-2">Application Submitted!</h2>
          <p className="text-zinc-400 text-sm mb-1">Your PT application is now under review.</p>
          <p className="text-zinc-600 text-xs mb-6">Typically reviewed within 2–5 business days.</p>
          <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-xl p-4 mb-6 text-left space-y-3">
            {(["submitted","under_review","approved"] as AppStatus[]).map((s,i) => {
              const cfg = appStatusConfig[s];
              const done = i === 0;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border ${done?"bg-green-500/15 border-green-500/30":"bg-zinc-800 border-zinc-700"}`}>
                    {done ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clock className="w-3.5 h-3.5 text-zinc-600" />}
                  </div>
                  <div>
                    <div className={`text-xs font-bold ${done?cfg.text:"text-zinc-600"}`}>{cfg.label}</div>
                    <div className="text-xs text-zinc-600">{cfg.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={() => navigate("/client/profile")} className="px-5 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-lg hover:bg-zinc-700 transition-colors">Back to Profile</button>
            <button onClick={() => navigate("/client/dashboard")} className="px-5 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">Go to Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/client/profile")} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-zinc-100">Apply to Become a Personal Trainer</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Complete all sections to submit your application for admin review</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-start gap-1 overflow-x-auto pb-1">
          {steps.map((s,i) => {
            const done   = i < currentStep;
            const active = i === currentStep;
            return (
              <button key={s.key} onClick={() => setCurrentStep(i)}
                className="flex flex-col items-center gap-1.5 flex-1 min-w-[60px] group transition-all">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all flex-shrink-0 ${
                  done   ? "bg-green-500 text-black"
                  : active ? "bg-green-500 text-black shadow-lg shadow-green-500/30"
                  : "bg-zinc-800 text-zinc-500 border border-zinc-700 group-hover:border-zinc-500"
                }`}>
                  {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
                </div>
                <span className={`text-xs text-center leading-tight hidden sm:block font-medium ${active?"text-green-400":done?"text-zinc-400":"text-zinc-600"}`}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500 shadow-sm shadow-green-500/50"
            style={{ width: `${(currentStep/(steps.length-1))*100}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-zinc-600">Step {currentStep+1} of {steps.length}</span>
          <span className="text-xs text-zinc-600">{Math.round((currentStep/(steps.length-1))*100)}% complete</span>
        </div>
      </div>

      {/* ── STEP 1: PERSONAL INFO ── */}
      {currentStep === 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-green-500/15 rounded-lg flex items-center justify-center"><User className="w-4 h-4 text-green-400" /></div>
            <h3 className="text-zinc-100 font-bold">Personal Information</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><p className={lbl}>Full Name *</p><input className={inp} defaultValue={`${user?.firstName || ''} ${user?.lastName || ''}`} /></div>
            <div><p className={lbl}>Date of Birth *</p><input type="date" className={inp} defaultValue={user?.age ? new Date(new Date().getFullYear() - user.age, 0, 1).toISOString().split('T')[0] : "1997-03-15"} /></div>
            <div>
              <p className={lbl}>Gender *</p>
              <select className={inp}><option>Male</option><option>Female</option><option>Prefer not to say</option></select>
            </div>
            <div><p className={lbl}>Phone Number *</p><input className={inp} placeholder="+66 xx xxx xxxx" defaultValue="+66 81 234 5678" /></div>
            <div className="sm:col-span-2">
              <p className={lbl}>Current Address *</p>
              <input className={inp} placeholder="Street, District, City, Province, Postal Code" defaultValue="123 Sukhumvit Rd, Khlong Toei, Bangkok 10110" />
            </div>
            <div><p className={lbl}>Nationality</p><input className={inp} defaultValue="Thai" /></div>
            <div><p className={lbl}>Email *</p><input type="email" className={inp} defaultValue={user?.email || ""} /></div>
          </div>
        </div>
      )}

      {/* ── STEP 2: IDENTITY / VERIFICATION ── */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-blue-500/8 border border-blue-500/20 rounded-xl px-4 py-3">
            <Shield className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-300">Your identity information is encrypted and only accessible to verified admins. This data is used for professional verification only.</p>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-500/15 rounded-lg flex items-center justify-center"><Shield className="w-4 h-4 text-blue-400" /></div>
              <h3 className="text-zinc-100 font-bold">Identity Verification</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className={lbl}>National / Citizen ID Number *</p>
                <input className={inp} placeholder="X XXXX XXXXX XX X" maxLength={20} />
                <p className="text-xs text-zinc-600 mt-1">13-digit Thai citizen ID</p>
              </div>
              <div>
                <p className={lbl}>Passport Number (optional)</p>
                <input className={inp} placeholder="For non-Thai nationals" />
              </div>
            </div>

            {/* Exactly 3 required identity document uploads */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <UploadBox
                label="Citizen ID — Front Side *"
                hint="Front of Thai citizen ID card · JPG/PNG · Max 10MB"
              />
              <UploadBox
                label="Citizen ID — Back Side *"
                hint="Back of Thai citizen ID card · JPG/PNG · Max 10MB"
              />
              <UploadBox
                label="Portrait / Profile Photo *"
                hint="Professional headshot · Minimum 400×400px · Max 5MB"
              />
            </div>

            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
              <p className="font-semibold text-zinc-400">Future Verification Support</p>
              <p>• Citizen ID OCR verification (coming soon)</p>
              <p>• Document authenticity check (coming soon)</p>
              <p>• Face match with portrait (coming soon)</p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 3: PROFESSIONAL EXPERIENCE ── */}
      {currentStep === 2 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-violet-500/15 rounded-lg flex items-center justify-center"><Briefcase className="w-4 h-4 text-violet-400" /></div>
            <h3 className="text-zinc-100 font-bold">Professional Background</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className={lbl}>Years of Experience as PT *</p>
              <select className={inp}>
                {["Less than 1 year","1–2 years","3–5 years","5–10 years","10+ years"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <p className={lbl}>Highest Education Level</p>
              <select className={inp}>
                {["High School","Diploma / Vocational","Bachelor's Degree","Master's Degree","PhD"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <p className={lbl}>Education Background *</p>
              <input className={inp} placeholder="e.g. Bachelor's in Sports Science, Chulalongkorn University" />
            </div>
            <div className="sm:col-span-2">
              <p className={lbl}>Previous Work Experience</p>
              <textarea rows={3} className={`${inp} resize-none`} placeholder="Describe your past roles, gyms, or coaching clients…" />
            </div>
          </div>
          <div>
            <p className={lbl}>Main Specialties * (select all that apply)</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {specialtyOptions.map(s => (
                <Chip key={s} label={s} active={specialties.includes(s)} onClick={() => toggle(specialties, setSpecialties, s)} />
              ))}
            </div>
            {specialties.length === 0 && <p className="text-xs text-zinc-600 mt-2">Select at least one specialty</p>}
          </div>
          <div>
            <p className={lbl}>Professional Bio *</p>
            <textarea rows={4} className={`${inp} resize-none`} placeholder="Describe your coaching philosophy, approach, and what makes you unique as a trainer… (min 100 characters)" />
          </div>
        </div>
      )}

      {/* ── STEP 4: CERTIFICATIONS ── */}
      {currentStep === 3 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500/15 rounded-lg flex items-center justify-center"><Award className="w-4 h-4 text-amber-400" /></div>
            <h3 className="text-zinc-100 font-bold">Certifications & Qualifications</h3>
          </div>
          {[1,2].map(n => (
            <div key={n} className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Certification {n}</p>
                {n===2 && <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-700">Optional</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><p className={lbl}>Certification Name {n===1?"*":""}</p><input className={inp} placeholder="e.g. NASM Certified Personal Trainer" /></div>
                <div><p className={lbl}>Issuing Organization {n===1?"*":""}</p><input className={inp} placeholder="e.g. NASM, ACE, ISSA, CSCS" /></div>
                <div><p className={lbl}>Issue Date {n===1?"*":""}</p><input type="date" className={inp} /></div>
                <div><p className={lbl}>Expiry Date</p><input type="date" className={inp} /></div>
                <div className="sm:col-span-2">
                  <p className={lbl}>Certification Status {n===1?"*":""}</p>
                  <div className="flex gap-2">
                    {["Valid","Expired","Lifetime (No Expiry)"].map(s => (
                      <button key={s} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        s==="Valid" ? "bg-green-500/15 text-green-400 border-green-500/40"
                                    : "bg-zinc-800 text-zinc-500 border-zinc-700/50 hover:border-zinc-600"
                      }`}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
              <UploadBox label={`Certificate Document / Image ${n===1?"*":"(Optional)"}`} hint="JPG, PNG or PDF · Max 10MB" />
            </div>
          ))}
          <button className="w-full py-2.5 border-2 border-dashed border-zinc-700 text-zinc-600 text-sm font-semibold rounded-xl hover:border-green-500/40 hover:text-green-400 transition-all flex items-center justify-center gap-2">
            <Award className="w-4 h-4" /> Add Another Certification
          </button>
        </div>
      )}

      {/* ── STEP 5: COACHING FOCUS ── */}
      {currentStep === 4 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500/15 rounded-lg flex items-center justify-center"><Users className="w-4 h-4 text-green-400" /></div>
            <h3 className="text-zinc-100 font-bold">Coaching Focus & Target Audience</h3>
          </div>
          <div>
            <p className={lbl}>Target Client Groups * (select all that apply)</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {targetOptions.map(t => (
                <Chip key={t} label={t} active={targets.includes(t)} onClick={() => toggle(targets, setTargets, t)} />
              ))}
            </div>
          </div>
          <div>
            <p className={lbl}>Primary Training Goals You Offer *</p>
            <div className="space-y-2">
              {[
                {key:"fat_loss",   label:"Fat Loss & Body Recomposition"},
                {key:"muscle",     label:"Muscle Building & Hypertrophy"},
                {key:"strength",   label:"Strength & Powerlifting"},
                {key:"rehab",      label:"Rehabilitation & Injury Recovery"},
                {key:"performance",label:"Sports Performance"},
                {key:"general",    label:"General Fitness & Health"},
              ].map(g => (
                <label key={g.key} className="flex items-center gap-3 p-3 bg-zinc-800/40 border border-zinc-700/40 rounded-lg cursor-pointer hover:border-green-500/30 transition-colors group">
                  <input type="checkbox" className="w-4 h-4 rounded accent-green-500" />
                  <span className="text-sm text-zinc-300 font-medium group-hover:text-zinc-200">{g.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className={lbl}>Training Methods & Approach</p>
            <textarea rows={3} className={`${inp} resize-none`} placeholder="Describe how you structure sessions, your coaching style, and what clients can expect…" />
          </div>
        </div>
      )}

      {/* ── STEP 6: SERVICE & AVAILABILITY ── */}
      {currentStep === 5 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500/15 rounded-lg flex items-center justify-center"><Calendar className="w-4 h-4 text-blue-400" /></div>
            <h3 className="text-zinc-100 font-bold">Service & Availability</h3>
          </div>
          <div>
            <p className={lbl}>Working Mode *</p>
            <div className="grid grid-cols-3 gap-2">
              {(["online","offline","hybrid"] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`py-2.5 rounded-xl text-sm font-bold border-2 capitalize transition-all ${
                    mode===m ? "bg-green-500/15 border-green-500 text-green-400"
                             : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600"
                  }`}>{m}</button>
              ))}
            </div>
          </div>
          <div>
            <p className={lbl}>Available Days *</p>
            <div className="flex gap-2 flex-wrap">
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                <Chip key={d} label={d} active={days.includes(d)} onClick={() => toggle(days, setDays, d)} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><p className={lbl}>Available From</p><input type="time" className={inp} defaultValue="06:00" /></div>
            <div><p className={lbl}>Available Until</p><input type="time" className={inp} defaultValue="20:00" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><p className={lbl}>Service Area / Location *</p><input className={inp} placeholder="e.g. Sukhumvit, Bangkok" /></div>
            <div><p className={lbl}>Gym / Facility Affiliation</p><input className={inp} placeholder="e.g. Fitness First Asok, freelance" /></div>
          </div>
          <div>
            <p className={lbl}>Session Pricing *</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><p className="text-xs text-zinc-600 mb-1">Per Session (THB)</p><input type="number" className={inp} placeholder="e.g. 800" /></div>
              <div><p className="text-xs text-zinc-600 mb-1">Package (10 sessions)</p><input type="number" className={inp} placeholder="e.g. 7000" /></div>
              <div><p className="text-xs text-zinc-600 mb-1">Monthly Program</p><input type="number" className={inp} placeholder="e.g. 3500" /></div>
            </div>
          </div>
          <div>
            <p className={lbl}>Additional Pricing Notes</p>
            <textarea rows={2} className={`${inp} resize-none`} placeholder="Any discounts, custom packages, trial sessions…" />
          </div>
        </div>
      )}

      {/* ── STEP 7: PORTFOLIO & SOCIAL ── */}
      {currentStep === 6 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-rose-500/15 rounded-lg flex items-center justify-center"><Globe className="w-4 h-4 text-rose-400" /></div>
            <h3 className="text-zinc-100 font-bold">Portfolio & Professional Branding</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><p className={lbl}><Linkedin className="w-3 h-3 inline mr-1 text-blue-400" />LinkedIn Profile</p><input className={inp} placeholder="https://linkedin.com/in/yourname" /></div>
            <div><p className={lbl}>🌐 Personal Website / Portfolio</p><input className={inp} placeholder="https://yourwebsite.com" /></div>
            <div><p className={lbl}><Instagram className="w-3 h-3 inline mr-1 text-rose-400" />Instagram</p><input className={inp} placeholder="@your_handle" /></div>
            <div><p className={lbl}>📘 Facebook Page</p><input className={inp} placeholder="facebook.com/yourpage" /></div>
            <div><p className={lbl}>🎵 TikTok</p><input className={inp} placeholder="@your_tiktok" /></div>
            <div><p className={lbl}><Youtube className="w-3 h-3 inline mr-1 text-red-400" />YouTube</p><input className={inp} placeholder="youtube.com/@yourchannel" /></div>
          </div>
          <UploadBox label="Portfolio Images / Before & After (Optional)" hint="JPG or PNG · Max 5 images · Max 5MB each" />
          <div>
            <p className={lbl}>Any Other Links or References</p>
            <textarea rows={2} className={`${inp} resize-none`} placeholder="Client testimonials, media features, competition results, etc." />
          </div>
        </div>
      )}

      {/* ── STEP 8: REVIEW & SUBMIT ── */}
      {currentStep === 7 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-3">
            <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-green-300">Review your information before submitting. You can go back to any step to make changes.</p>
          </div>
          {[
            { title:"Personal Information", icon:User,      step:0, rows:[
                {label:"Full Name",    value:`${user?.firstName || ''} ${user?.lastName || ''}`},
                {label:"DOB",          value:user?.age ? new Date(new Date().getFullYear() - user.age, 0, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Mar 15, 1997"},
                {label:"Gender",       value:"Prefer not to say"},
                {label:"Phone",        value:"+66 81 234 5678"},
                {label:"Address",      value:"123 Sukhumvit Rd, Bangkok 10110"},
                {label:"Email",        value:user?.email || "alex@example.com"},
            ]},
            { title:"Identity & Verification", icon:Shield, step:1, rows:[
                {label:"National ID",   value:"1 2345 67890 12 3 (entered)"},
                {label:"ID Front",      value:"✓ Uploaded"},
                {label:"ID Back",       value:"✓ Uploaded"},
                {label:"Portrait",      value:"✓ Uploaded"},
            ]},
            { title:"Professional Experience", icon:Briefcase, step:2, rows:[
                {label:"Experience",  value:"3–5 years"},
                {label:"Education",   value:"Bachelor's in Sports Science"},
                {label:"Specialties", value:specialties.length>0?specialties.join(", "):"Not selected"},
            ]},
            { title:"Certifications", icon:Award, step:3, rows:[
                {label:"Cert 1",  value:"NASM Certified Personal Trainer (Valid)"},
                {label:"File",    value:"✓ Uploaded"},
            ]},
            { title:"Coaching Focus", icon:Users, step:4, rows:[
                {label:"Target Clients", value:targets.length>0?targets.join(", "):"Not selected"},
            ]},
            { title:"Service & Availability", icon:Calendar, step:5, rows:[
                {label:"Mode",     value:mode.charAt(0).toUpperCase()+mode.slice(1)},
                {label:"Days",     value:days.length>0?days.join(", "):"Not selected"},
                {label:"Location", value:"Sukhumvit, Bangkok"},
                {label:"Price",    value:"฿800 / session"},
            ]},
          ].map(section => (
            <div key={section.title} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <section.icon className="w-4 h-4 text-green-400" />
                  <h4 className="text-sm font-bold text-zinc-200">{section.title}</h4>
                </div>
                <button onClick={() => setCurrentStep(section.step)} className="text-xs text-green-400 hover:text-green-300 transition-colors flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" /> Edit
                </button>
              </div>
              <div className="space-y-1.5">
                {section.rows.map(r => (
                  <div key={r.label} className="flex gap-3 text-sm">
                    <span className="text-zinc-600 w-28 flex-shrink-0">{r.label}</span>
                    <span className="text-zinc-300 font-medium">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
            <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-zinc-400" /> Declaration & Consent
            </h4>
            {[
              "All information provided is accurate and truthful to the best of my knowledge.",
              "I consent to my identity and professional information being reviewed by Gymnini admins.",
              "I understand that submitting false information may result in permanent account ban.",
              "I agree to Gymnini's Trainer Terms of Service and Code of Conduct.",
            ].map(text => (
              <label key={text} className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 mt-0.5 rounded accent-green-500 flex-shrink-0" />
                <span className="text-xs text-zinc-400 leading-relaxed group-hover:text-zinc-300 transition-colors">{text}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-600 bg-zinc-800/40 border border-zinc-700/40 rounded-lg px-3 py-2">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            Your progress is auto-saved. You can save as draft and return later before submitting.
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        {currentStep > 0 && (
          <button onClick={goPrev} className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-xl hover:bg-zinc-700 transition-all">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        )}
        <button className="px-4 py-2.5 border border-zinc-700/60 text-zinc-400 text-sm font-semibold rounded-xl hover:bg-zinc-800 transition-colors">
          Save Draft
        </button>
        <div className="flex-1" />
        {currentStep < steps.length-1 ? (
          <button onClick={goNext} className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={() => setSubmitted(true)} className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20">
            <CheckCircle className="w-4 h-4" /> Submit Application
          </button>
        )}
      </div>
    </div>
  );
}
