import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Shield, Briefcase, Award, Users, Calendar,
  Globe, CheckCircle, ChevronLeft, ChevronRight,
  Upload, X, Check, AlertCircle, Clock, FileText,
  Instagram, Youtube, Linkedin, ArrowLeft, Loader2,
  Facebook, Plus, Trash2
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { ptApplicationService, PTApplication, PTApplicationCertificate } from "../../services/ptApplicationService";

const inp = "w-full px-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 placeholder-zinc-600 transition-all";
const lbl = "text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold";

const steps = [
  { key: "personal", label: "Personal Info", icon: User },
  { key: "identity", label: "Identity & Verification", icon: Shield },
  { key: "experience", label: "Professional Experience", icon: Briefcase },
  { key: "certs", label: "Certifications", icon: Award },
  { key: "focus", label: "Coaching Focus", icon: Users },
  { key: "availability", label: "Service & Availability", icon: Calendar },
  { key: "portfolio", label: "Portfolio & Social", icon: Globe },
  { key: "review", label: "Review & Submit", icon: CheckCircle },
];

const specialtyOptions = [
  "Muscle Gain", "Fat Loss", "Powerlifting", "Bodybuilding", "Calisthenics",
  "Yoga", "Rehabilitation", "Sports Nutrition", "HIIT", "Functional Training",
  "Endurance", "Flexibility & Mobility", "Sports Performance", "Boxing & MMA",
];
const targetOptions = [
  "Beginners", "Weight-loss clients", "Postpartum women", "Advanced trainees",
  "Office workers", "Athletes", "Rehab clients", "Seniors", "Teens / Youth", "Competitive bodybuilders",
];
const trainingGoalOptions = [
  "Fat Loss & Body Recomposition",
  "Muscle Building & Hypertrophy",
  "Strength & Powerlifting",
  "Rehabilitation & Injury Recovery",
  "Sports Performance",
  "General Fitness & Health",
];
const dayOptions = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const appStatusConfig: Record<string, { label: string; bg: string; text: string; border: string; dot: string; desc: string }> = {
  not_applied: { label: "Not Applied", bg: "bg-zinc-700/50", text: "text-zinc-400", border: "border-zinc-700", dot: "bg-zinc-500", desc: "You have not applied yet." },
  DRAFT: { label: "Draft", bg: "bg-zinc-700/50", text: "text-zinc-400", border: "border-zinc-700", dot: "bg-zinc-400", desc: "Your application is saved as draft." },
  SUBMITTED: { label: "Submitted", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", dot: "bg-blue-500", desc: "Application submitted, awaiting admin review." },
  UNDER_REVIEW: { label: "Under Review", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", dot: "bg-amber-500", desc: "Admin is reviewing your application." },
  NEEDS_MORE_INFO: { label: "Additional Info Needed", bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", dot: "bg-orange-500", desc: "Admin has requested more information." },
  APPROVED: { label: "Approved ✓", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20", dot: "bg-green-500", desc: "Congratulations! Your PT application has been approved." },
  REJECTED: { label: "Rejected", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-500", desc: "Your application was not approved at this time." },
};

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${active ? "bg-green-500/15 text-green-400 border-green-500/40"
          : "bg-zinc-800 text-zinc-500 border-zinc-700/50 hover:border-zinc-600"
        }`}>
      {active && <Check className="w-3 h-3 inline mr-1" />}{label}
    </button>
  );
}

function UploadBox({ label: labelText, hint, value, onUpload }: { label: string; hint?: string; value?: string; onUpload: (url: string) => void }) {
  const [isUploading, setIsUploading] = useState(false);

  const getFullUrl = (url: string) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    // @ts-ignore
    const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
    return `${baseUrl}${url}`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const resp = await ptApplicationService.uploadDocument(file);
      console.log("Upload response:", resp);
      onUpload(resp.url);
    } catch (error) {
      console.error("Upload failed", error);
      alert("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <p className={lbl}>{labelText}</p>
      <label className={`block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${value ? "border-green-500/40 bg-zinc-800/40"
        : "border-zinc-700 hover:border-green-500/40 hover:bg-zinc-800/40"
        }`}>
        <input type="file" className="hidden" onChange={handleFileChange} disabled={isUploading} accept="image/*,.pdf" />
        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
            <span className="text-xs text-zinc-500">Uploading...</span>
          </div>
        ) : value ? (
          <div className="flex flex-col items-center gap-3">
            {value.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/) || value.includes('image') ? (
              <div className="relative group">
                <img 
                  src={getFullUrl(value)} 
                  alt="Preview" 
                  className="h-32 w-auto rounded-lg object-cover border border-zinc-700 shadow-lg"
                  onError={(e) => {
                    console.error("Image preview failed to load:", getFullUrl(value));
                    (e.target as any).src = "https://placehold.co/200x200?text=Format+Error";
                  }}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                  <p className="text-[10px] text-white font-bold uppercase tracking-wider">Change photo</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-semibold text-wrap">File uploaded</span>
              </div>
            )}
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onUpload(""); }}
              className="px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-400 hover:text-red-400 text-[11px] font-medium transition-colors flex items-center gap-1.5"
            >
              <X className="w-3 h-3" /> Remove file
            </button>
          </div>
        ) : (
          <div>
            <Upload className="w-6 h-6 text-zinc-600 mx-auto mb-1" />
            <p className="text-xs text-zinc-500">{hint || "Click to upload or drag & drop"}</p>
          </div>
        )}
      </label>
    </div>
  );
}

function ReviewSection({ icon, title, onEdit, children }: { icon: React.ReactNode; title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-700/30 flex items-center justify-center">{icon}</div>
          <h4 className="text-sm font-bold text-zinc-200">{title}</h4>
        </div>
        <button onClick={onEdit} className="text-xs text-green-400 hover:text-green-300 font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Edit
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, isStatus }: { label: string; value?: string | null; isStatus?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium ${isStatus && value?.startsWith("✓") ? "text-green-400" : value ? "text-zinc-200" : "text-zinc-600"}`}>
        {value || "Not set"}
      </span>
    </div>
  );
}

const emptyCert: PTApplicationCertificate = { certificateName: '', issuingOrganization: '', isCurrentlyValid: true, certificationStatus: 'Valid' };

export function PTApplicationPage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [portfolioUploading, setPortfolioUploading] = useState(false);
  const [consent, setConsent] = useState({
    accurate: false,
    reviewConsent: false,
    falseInfoWarning: false,
    termsAgreed: false,
  });

  const [formData, setFormData] = useState<Partial<PTApplication>>({
    mainSpecialties: [],
    targetClientGroups: [],
    primaryTrainingGoals: [],
    operatingAreas: [],
    availableDays: [],
    certificates: [{ ...emptyCert }],
    media: [],
  });

  const { data: appData, isLoading } = useQuery({
    queryKey: ['pt-application-me'],
    queryFn: () => ptApplicationService.getMe()
  });

  useEffect(() => {
    if (appData) {
      setFormData(prev => ({
        ...prev,
        ...appData,
        mainSpecialties: appData.mainSpecialties || [],
        targetClientGroups: appData.targetClientGroups || [],
        primaryTrainingGoals: appData.primaryTrainingGoals || [],
        operatingAreas: appData.operatingAreas || [],
        availableDays: appData.availableDays || [],
        certificates: appData.certificates?.length > 0 ? appData.certificates : [{ ...emptyCert }],
        media: appData.media || [],
      }));
    }
  }, [appData]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<PTApplication>) => ptApplicationService.saveDraft(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pt-application-me'] })
  });

  const submitMutation = useMutation({
    mutationFn: () => ptApplicationService.submit(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pt-application-me'] });
      alert("Application submitted successfully!");
    },
    onError: (err: any) => {
      alert(err.response?.data?.error || "Submission failed. Please check all required fields.");
    }
  });

  const toggle = (field: keyof PTApplication, val: string) => {
    const current = (formData[field] as string[]) || [];
    const next = current.includes(val) ? current.filter(x => x !== val) : [...current, val];
    setFormData(prev => ({ ...prev, [field]: next }));
  };

  const updateField = (field: keyof PTApplication, val: any) => {
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  // Certificate management
  const addCertificate = () => {
    const certs = [...(formData.certificates || [])];
    certs.push({ ...emptyCert });
    updateField('certificates', certs);
  };

  const removeCertificate = (index: number) => {
    const certs = [...(formData.certificates || [])];
    certs.splice(index, 1);
    updateField('certificates', certs);
  };

  const updateCertificate = (index: number, field: string, value: any) => {
    const certs = [...(formData.certificates || [])];
    certs[index] = { ...certs[index], [field]: value };
    updateField('certificates', certs);
  };

  // Portfolio media management
  const portfolioMedia = (formData.media || []).filter((m: any) => m.groupType === 'PORTFOLIO');

  const handlePortfolioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (portfolioMedia.length >= 5) { alert("Maximum 5 portfolio images allowed"); return; }
    setPortfolioUploading(true);
    try {
      const { url } = await ptApplicationService.uploadDocument(file);
      const media = [...(formData.media || [])];
      media.push({ groupType: 'PORTFOLIO', fileUrl: url, label: file.name });
      updateField('media', media);
    } catch (error) {
      console.error('Portfolio upload failed', error);
      alert("Upload failed. Please try again.");
    } finally {
      setPortfolioUploading(false);
    }
  };

  const removePortfolioImage = (mediaIndex: number) => {
    const allMedia = [...(formData.media || [])];
    let count = 0;
    for (let i = 0; i < allMedia.length; i++) {
      if (allMedia[i].groupType === 'PORTFOLIO') {
        if (count === mediaIndex) { allMedia.splice(i, 1); break; }
        count++;
      }
    }
    updateField('media', allMedia);
  };

  const handleSaveDraft = () => saveMutation.mutate(formData);
  const handleSubmit = () => submitMutation.mutate();

  const goNext = () => {
    handleSaveDraft();
    setCurrentStep(s => Math.min(s + 1, steps.length - 1));
  };
  const goPrev = () => setCurrentStep(s => Math.max(s - 1, 0));

  const allConsented = consent.accurate && consent.reviewConsent && consent.falseInfoWarning && consent.termsAgreed;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black">
        <Loader2 className="w-10 h-10 text-green-500 animate-spin mb-4" />
        <p className="text-zinc-400">Loading your application...</p>
      </div>
    );
  }

  const status = appData?.status || 'not_applied';

  if (status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'APPROVED') {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="bg-zinc-900 rounded-xl border border-green-500/20 p-10 text-center">
          <div className="w-20 h-20 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-xl shadow-green-500/10">
            {status === 'APPROVED' ? <CheckCircle className="w-10 h-10 text-green-400" /> : <Clock className="w-10 h-10 text-blue-400" />}
          </div>
          <h2 className="text-zinc-100 font-bold mb-2">
            {status === 'APPROVED' ? "Application Approved!" : "Application Under Review"}
          </h2>
          <p className="text-zinc-400 text-sm mb-1">{appStatusConfig[status].desc}</p>
          {status !== 'APPROVED' && <p className="text-zinc-600 text-xs mb-6">Typically reviewed within 2–5 business days.</p>}

          <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-xl p-4 mb-6 text-left space-y-3">
            {["SUBMITTED", "UNDER_REVIEW", "APPROVED"].map((s) => {
              const cfg = appStatusConfig[s];
              const isCurrent = status === s;
              const isPast = (status === 'UNDER_REVIEW' && s === 'SUBMITTED') || (status === 'APPROVED');
              const done = isCurrent || isPast;

              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border ${done ? "bg-green-500/15 border-green-500/30" : "bg-zinc-800 border-zinc-700"}`}>
                    {done ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clock className="w-3.5 h-3.5 text-zinc-600" />}
                  </div>
                  <div>
                    <div className={`text-xs font-bold ${done ? cfg.text : "text-zinc-600"}`}>{cfg.label}</div>
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
          <h1 className="text-zinc-100 font-bold text-xl">Apply to Become a Personal Trainer</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Complete all sections to submit your application for admin review</p>
        </div>
      </div>

      {/* NEEDS_MORE_INFO / REJECTED banner */}
      {status === 'NEEDS_MORE_INFO' && formData.adminNote && (
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-orange-400">Additional Information Requested</p>
            <p className="text-xs text-zinc-400 mt-1">{formData.adminNote}</p>
          </div>
        </div>
      )}
      {status === 'REJECTED' && formData.rejectionReason && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-400">Application Rejected</p>
            <p className="text-xs text-zinc-400 mt-1">{formData.rejectionReason}</p>
          </div>
        </div>
      )}

      {/* Stepper */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-start gap-1 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <button key={s.key} onClick={() => setCurrentStep(i)}
                className="flex flex-col items-center gap-1.5 flex-1 min-w-[60px] group transition-all">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all flex-shrink-0 ${done ? "bg-green-500 text-black"
                    : active ? "bg-green-500 text-black shadow-lg shadow-green-500/30"
                      : "bg-zinc-800 text-zinc-500 border border-zinc-700 group-hover:border-zinc-500"
                  }`}>
                  {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
                </div>
                <span className={`text-[10px] text-center leading-tight hidden sm:block font-medium ${active ? "text-green-400" : done ? "text-zinc-400" : "text-zinc-600"}`}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 mb-1">
          <span>Step {currentStep + 1} of {steps.length}</span>
          <span>{Math.round((currentStep / (steps.length - 1)) * 100)}% complete</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500 shadow-sm shadow-green-500/50"
            style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }} />
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden flex flex-col min-h-[400px]">
        <div className="p-6 flex-1">
          {/* ── STEP 1: Personal (PRESERVED) ── */}
          {currentStep === 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Phone Number</label>
                  <input type="tel" className={inp} placeholder="+84 ..." value={formData.phoneNumber || ""} onChange={e => updateField("phoneNumber", e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>National ID / Passport</label>
                  <input type="text" className={inp} placeholder="ID number..." value={formData.nationalIdNumber || ""} onChange={e => updateField("nationalIdNumber", e.target.value)} />
                </div>
              </div>
              <div>
                <label className={lbl}>Current Address</label>
                <input type="text" className={inp} placeholder="Street, City, Country..." value={formData.currentAddress || ""} onChange={e => updateField("currentAddress", e.target.value)} />
              </div>
            </div>
          )}

          {/* ── STEP 2: Identity (PRESERVED) ── */}
          {currentStep === 1 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-500/80 leading-relaxed">
                  We need to verify your identity. Please upload clear photos of your ID card (front & back) and a recent portrait.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UploadBox label="ID Card (Front)" value={formData.idCardFrontUrl} onUpload={url => updateField("idCardFrontUrl", url)} />
                <UploadBox label="ID Card (Back)" value={formData.idCardBackUrl} onUpload={url => updateField("idCardBackUrl", url)} />
              </div>
              <UploadBox label="Portrait Photo" value={formData.portraitPhotoUrl} onUpload={url => updateField("portraitPhotoUrl", url)} />
            </div>
          )}

          {/* ── STEP 3: Professional Experience ── */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Briefcase className="w-4 h-4 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Professional Background</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Years of Experience as PT *</label>
                  <select className={inp} value={formData.yearsOfExperience || ""} onChange={e => updateField("yearsOfExperience", e.target.value)}>
                    <option value="">Select experience...</option>
                    <option value="<1">Less than 1 year</option>
                    <option value="1-3">1 - 3 years</option>
                    <option value="3-5">3 - 5 years</option>
                    <option value="5-10">5 - 10 years</option>
                    <option value="10+">More than 10 years</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Education Background *</label>
                <input type="text" className={inp} placeholder="e.g. Bachelor's in Sports Science, Chulalongkorn University" value={formData.educationBackground || ""} onChange={e => updateField("educationBackground", e.target.value)} />
              </div>

              <div>
                <label className={lbl}>Previous Work Experience</label>
                <textarea className={`${inp} min-h-[100px] resize-none`} placeholder="Describe your past roles, gyms, or coaching clients..." value={formData.previousWorkExperience || ""} onChange={e => updateField("previousWorkExperience", e.target.value)} />
              </div>

              <div>
                <label className={lbl}>Main Specialties * (Select all that apply)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {specialtyOptions.map(opt => (
                    <Chip key={opt} label={opt} active={formData.mainSpecialties?.includes(opt) || false} onClick={() => toggle("mainSpecialties", opt)} />
                  ))}
                </div>
                {(!formData.mainSpecialties || formData.mainSpecialties.length === 0) && (
                  <p className="text-xs text-zinc-600 mt-1.5">Select at least one specialty</p>
                )}
              </div>

              <div>
                <label className={lbl}>Professional Bio *</label>
                <textarea className={`${inp} min-h-[120px] resize-none`} placeholder="Describe your coaching philosophy, approach, and what makes you unique as a trainer... (min 100 characters)" value={formData.professionalBio || ""} onChange={e => updateField("professionalBio", e.target.value)} />
                <p className="text-xs text-zinc-600 mt-1">{(formData.professionalBio || "").length}/100 characters minimum</p>
              </div>
            </div>
          )}

          {/* ── STEP 4: Certifications ── */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Award className="w-4 h-4 text-purple-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Certifications & Qualifications</h3>
              </div>

              {(formData.certificates || []).map((cert, index) => (
                <div key={index} className="border border-zinc-700/50 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-zinc-300 uppercase tracking-wide">Certification {index + 1}</h4>
                    <div className="flex items-center gap-2">
                      {index > 0 && (
                        <>
                          <span className="text-[10px] text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">Optional</span>
                          <button type="button" onClick={() => removeCertificate(index)} className="text-zinc-600 hover:text-red-400 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={lbl}>Certification Name {index === 0 ? '*' : ''}</label>
                      <input type="text" className={inp} placeholder="e.g. NASM Certified Personal Trainer" value={cert.certificateName || ""} onChange={e => updateCertificate(index, 'certificateName', e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Issuing Organization {index === 0 ? '*' : ''}</label>
                      <input type="text" className={inp} placeholder="e.g. NASM, ACE, ISSA, CSCS" value={cert.issuingOrganization || ""} onChange={e => updateCertificate(index, 'issuingOrganization', e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={lbl}>Issue Date {index === 0 ? '*' : ''}</label>
                      <input type="date" className={inp} value={cert.issueDate ? cert.issueDate.substring(0, 10) : ""} onChange={e => updateCertificate(index, 'issueDate', e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Expiry Date</label>
                      <input type="date" className={inp} value={cert.expirationDate ? cert.expirationDate.substring(0, 10) : ""} onChange={e => updateCertificate(index, 'expirationDate', e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <label className={lbl}>Certification Status {index === 0 ? '*' : ''}</label>
                    <div className="flex gap-2 mt-1">
                      {[{ label: "Valid", val: "Valid" }, { label: "Expired", val: "Expired" }, { label: "Lifetime (No Expiry)", val: "Lifetime" }].map(s => (
                        <button key={s.val} type="button"
                          onClick={() => {
                            updateCertificate(index, 'certificationStatus', s.val);
                            updateCertificate(index, 'isCurrentlyValid', s.val === 'Valid' || s.val === 'Lifetime');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            cert.certificationStatus === s.val
                              ? "bg-green-500/15 text-green-400 border-green-500/40"
                              : "bg-zinc-800 text-zinc-500 border-zinc-700/50 hover:border-zinc-600"
                          }`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <UploadBox
                    label={`Certificate Document / Image ${index === 0 ? '*' : '(Optional)'}`}
                    hint="JPG, PNG or PDF · Max 10MB"
                    value={cert.certificateFileUrl}
                    onUpload={url => updateCertificate(index, 'certificateFileUrl', url)}
                  />
                </div>
              ))}

              <button type="button" onClick={addCertificate}
                className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-zinc-700 rounded-xl text-sm text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-all">
                <Plus className="w-4 h-4" /> Add Another Certification
              </button>
            </div>
          )}

          {/* ── STEP 5: Coaching Focus ── */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Coaching Focus & Target Audience</h3>
              </div>

              <div>
                <label className={lbl}>Target Client Groups * (Select all that apply)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {targetOptions.map(opt => (
                    <Chip key={opt} label={opt} active={formData.targetClientGroups?.includes(opt) || false} onClick={() => toggle("targetClientGroups", opt)} />
                  ))}
                </div>
              </div>

              <div>
                <label className={lbl}>Primary Training Goals You Offer *</label>
                <div className="space-y-2 mt-2">
                  {trainingGoalOptions.map(goal => (
                    <label key={goal} className="flex items-center gap-3 p-3 bg-zinc-800/40 border border-zinc-700/40 rounded-xl cursor-pointer hover:border-zinc-600 transition-all">
                      <input type="checkbox"
                        checked={formData.primaryTrainingGoals?.includes(goal) || false}
                        onChange={() => toggle("primaryTrainingGoals", goal)}
                        className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500/30"
                      />
                      <span className="text-sm text-zinc-300 font-medium">{goal}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={lbl}>Training Methods & Approach</label>
                <textarea className={`${inp} min-h-[100px] resize-none`} placeholder="Describe how you structure sessions, your coaching style, and what clients can expect..." value={formData.trainingMethodsApproach || ""} onChange={e => updateField("trainingMethodsApproach", e.target.value)} />
              </div>
            </div>
          )}

          {/* ── STEP 6: Service & Availability ── */}
          {currentStep === 5 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-teal-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Service & Availability</h3>
              </div>

              <div>
                <label className={lbl}>Working Mode *</label>
                <div className="grid grid-cols-3 gap-3">
                  {["Online", "Offline", "Hybrid"].map(m => (
                    <button key={m} type="button" onClick={() => updateField("serviceMode", m.toUpperCase() as any)}
                      className={`py-3 rounded-xl border text-sm font-bold transition-all ${formData.serviceMode === m.toUpperCase()
                          ? "bg-green-500/15 border-green-500/40 text-green-400"
                          : "bg-zinc-800/40 border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                        }`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={lbl}>Available Days *</label>
                <div className="flex gap-2 mt-1">
                  {dayOptions.map(day => (
                    <button key={day} type="button"
                      onClick={() => toggle("availableDays", day)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                        formData.availableDays?.includes(day)
                          ? "bg-green-500/15 text-green-400 border-green-500/40"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700/50 hover:border-zinc-600"
                      }`}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Available From</label>
                  <input type="time" className={inp} value={formData.availableFrom || ""} onChange={e => updateField("availableFrom", e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Available Until</label>
                  <input type="time" className={inp} value={formData.availableUntil || ""} onChange={e => updateField("availableUntil", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Service Area / Location *</label>
                  <input type="text" className={inp} placeholder="e.g. Sukhumvit, Bangkok" value={formData.operatingAreas?.[0] || ""} onChange={e => updateField("operatingAreas", [e.target.value])} />
                </div>
                <div>
                  <label className={lbl}>Gym / Facility Affiliation</label>
                  <input type="text" className={inp} placeholder="e.g. Fitness First Asok, freelance" value={formData.gymAffiliation || ""} onChange={e => updateField("gymAffiliation", e.target.value)} />
                </div>
              </div>

              <div>
                <label className={lbl}>Session Pricing *</label>
                <div className="grid grid-cols-3 gap-3 mt-1">
                  <div>
                    <p className="text-[10px] text-zinc-600 mb-1">Per Session (THB)</p>
                    <input type="number" className={inp} placeholder="e.g. 800" value={formData.desiredSessionPrice ?? ""} onChange={e => updateField("desiredSessionPrice", e.target.value ? parseFloat(e.target.value) : null)} />
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-600 mb-1">Package (10 sessions)</p>
                    <input type="number" className={inp} placeholder="e.g. 7000" value={formData.packagePrice ?? ""} onChange={e => updateField("packagePrice", e.target.value ? parseFloat(e.target.value) : null)} />
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-600 mb-1">Monthly Program</p>
                    <input type="number" className={inp} placeholder="e.g. 3500" value={formData.monthlyProgramPrice ?? ""} onChange={e => updateField("monthlyProgramPrice", e.target.value ? parseFloat(e.target.value) : null)} />
                  </div>
                </div>
              </div>

              <div>
                <label className={lbl}>Additional Pricing Notes</label>
                <textarea className={`${inp} min-h-[80px] resize-none`} placeholder="Any discounts, custom packages, trial sessions..." value={formData.additionalPricingNotes || ""} onChange={e => updateField("additionalPricingNotes", e.target.value)} />
              </div>
            </div>
          )}

          {/* ── STEP 7: Portfolio & Social ── */}
          {currentStep === 6 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-pink-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Portfolio & Professional Branding</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>
                    <Linkedin className="inline w-3.5 h-3.5 mr-1.5 text-blue-400" />
                    LinkedIn Profile
                  </label>
                  <input type="url" className={inp} placeholder="https://linkedin.com/in/yourname" value={formData.linkedinUrl || ""} onChange={e => updateField("linkedinUrl", e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>
                    <Globe className="inline w-3.5 h-3.5 mr-1.5 text-green-400" />
                    Personal Website / Portfolio
                  </label>
                  <input type="url" className={inp} placeholder="https://yourwebsite.com" value={formData.websiteUrl || ""} onChange={e => updateField("websiteUrl", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>
                    <Instagram className="inline w-3.5 h-3.5 mr-1.5 text-pink-400" />
                    Instagram
                  </label>
                  <input type="text" className={inp} placeholder="@your_handle" value={formData.socialLinks?.instagram || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, instagram: e.target.value })} />
                </div>
                <div>
                  <label className={lbl}>
                    <Facebook className="inline w-3.5 h-3.5 mr-1.5 text-blue-500" />
                    Facebook Page
                  </label>
                  <input type="text" className={inp} placeholder="facebook.com/yourpage" value={formData.socialLinks?.facebook || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, facebook: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>
                    <svg className="inline w-3.5 h-3.5 mr-1.5 text-cyan-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.06a6.27 6.27 0 00-.79-.05A6.34 6.34 0 003.15 15.5a6.27 6.27 0 006.34 6.34 6.21 6.21 0 004.49-1.92 6.34 6.34 0 001.85-4.42V8.87a8.16 8.16 0 004.76 1.52V6.94a4.83 4.83 0 01-1-.25z" /></svg>
                    TikTok
                  </label>
                  <input type="text" className={inp} placeholder="@your_tiktok" value={formData.socialLinks?.tiktok || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, tiktok: e.target.value })} />
                </div>
                <div>
                  <label className={lbl}>
                    <Youtube className="inline w-3.5 h-3.5 mr-1.5 text-red-500" />
                    YouTube
                  </label>
                  <input type="text" className={inp} placeholder="youtube.com/@yourchannel" value={formData.socialLinks?.youtube || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, youtube: e.target.value })} />
                </div>
              </div>

              {/* Portfolio Images */}
              <div>
                <label className={lbl}>Portfolio Images / Before & After (Optional)</label>
                <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  portfolioMedia.length > 0 ? "border-green-500/30 bg-green-500/5" : "border-zinc-700 hover:border-green-500/40 hover:bg-zinc-800/40"
                }`}>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePortfolioUpload} disabled={portfolioUploading} />
                  {portfolioUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
                      <span className="text-xs text-zinc-500">Uploading...</span>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-6 h-6 text-zinc-600 mx-auto mb-1" />
                      <p className="text-xs text-zinc-500">JPG or PNG · Max 5 images · Max 5MB each</p>
                    </div>
                  )}
                </label>
                {portfolioMedia.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {portfolioMedia.map((m: any, i: number) => (
                      <div key={i} className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-xs text-zinc-300">{m.label || `Portfolio image ${i + 1}`}</span>
                        </div>
                        <button onClick={() => removePortfolioImage(i)} className="text-zinc-600 hover:text-red-400">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className={lbl}>Any Other Links or References</label>
                <textarea className={`${inp} min-h-[80px] resize-none`} placeholder="Client testimonials, media features, competition results, etc." value={formData.otherReferences || ""} onChange={e => updateField("otherReferences", e.target.value)} />
              </div>
            </div>
          )}

          {/* ── STEP 8: Review & Submit ── */}
          {currentStep === 7 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 flex gap-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Review your information before submitting. You can go back to any step to make changes.
                </p>
              </div>

              {/* Personal Information */}
              <ReviewSection icon={<User className="w-4 h-4 text-green-400" />} title="Personal Information" onEdit={() => setCurrentStep(0)}>
                <ReviewRow label="Full Name" value={user ? `${user.firstName} ${user.lastName}` : undefined} />
                <ReviewRow label="Phone" value={formData.phoneNumber} />
                <ReviewRow label="Address" value={formData.currentAddress} />
                <ReviewRow label="Email" value={user?.email} />
              </ReviewSection>

              {/* Identity & Verification */}
              <ReviewSection icon={<Shield className="w-4 h-4 text-cyan-400" />} title="Identity & Verification" onEdit={() => setCurrentStep(1)}>
                <ReviewRow label="National ID" value={formData.nationalIdNumber ? `${formData.nationalIdNumber} (entered)` : undefined} />
                <ReviewRow label="ID Front" value={formData.idCardFrontUrl ? "✓ Uploaded" : undefined} isStatus />
                <ReviewRow label="ID Back" value={formData.idCardBackUrl ? "✓ Uploaded" : undefined} isStatus />
                <ReviewRow label="Portrait" value={formData.portraitPhotoUrl ? "✓ Uploaded" : undefined} isStatus />
              </ReviewSection>

              {/* Professional Experience */}
              <ReviewSection icon={<Briefcase className="w-4 h-4 text-amber-400" />} title="Professional Experience" onEdit={() => setCurrentStep(2)}>
                <ReviewRow label="Experience" value={formData.yearsOfExperience} />
                <ReviewRow label="Education" value={formData.educationBackground} />
                <ReviewRow label="Specialties" value={formData.mainSpecialties?.length ? formData.mainSpecialties.join(", ") : "Not selected"} />
              </ReviewSection>

              {/* Certifications */}
              <ReviewSection icon={<Award className="w-4 h-4 text-purple-400" />} title="Certifications" onEdit={() => setCurrentStep(3)}>
                {(formData.certificates || []).filter(c => c.certificateName).map((cert, i) => (
                  <div key={i}>
                    <ReviewRow label={`Cert ${i + 1}`} value={`${cert.certificateName} (${cert.certificationStatus || 'Valid'})`} />
                    <ReviewRow label="File" value={cert.certificateFileUrl ? "✓ Uploaded" : "Not uploaded"} isStatus />
                  </div>
                ))}
                {(!formData.certificates || formData.certificates.filter(c => c.certificateName).length === 0) && (
                  <ReviewRow label="Certificates" value="None added" />
                )}
              </ReviewSection>

              {/* Coaching Focus */}
              <ReviewSection icon={<Users className="w-4 h-4 text-blue-400" />} title="Coaching Focus" onEdit={() => setCurrentStep(4)}>
                <ReviewRow label="Target Clients" value={formData.targetClientGroups?.length ? formData.targetClientGroups.join(", ") : "Not selected"} />
                <ReviewRow label="Training Goals" value={formData.primaryTrainingGoals?.length ? formData.primaryTrainingGoals.join(", ") : "Not selected"} />
              </ReviewSection>

              {/* Service & Availability */}
              <ReviewSection icon={<Calendar className="w-4 h-4 text-teal-400" />} title="Service & Availability" onEdit={() => setCurrentStep(5)}>
                <ReviewRow label="Mode" value={formData.serviceMode} />
                <ReviewRow label="Days" value={formData.availableDays?.length ? formData.availableDays.join(", ") : "Not selected"} />
                <ReviewRow label="Location" value={formData.operatingAreas?.[0]} />
                <ReviewRow label="Price" value={formData.desiredSessionPrice ? `฿${formData.desiredSessionPrice} / session` : undefined} />
              </ReviewSection>

              {/* Declaration & Consent */}
              <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-zinc-700/30 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-zinc-400" />
                  </div>
                  <h4 className="text-sm font-bold text-zinc-200">Declaration & Consent</h4>
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'accurate' as const, text: 'All information provided is accurate and truthful to the best of my knowledge.' },
                    { key: 'reviewConsent' as const, text: 'I consent to my identity and professional information being reviewed by Gymnini admins.' },
                    { key: 'falseInfoWarning' as const, text: 'I understand that submitting false information may result in permanent account ban.' },
                    { key: 'termsAgreed' as const, text: "I agree to Gymnini's Trainer Terms of Service and Code of Conduct." },
                  ].map(item => (
                    <label key={item.key} className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={consent[item.key]}
                        onChange={e => setConsent(prev => ({ ...prev, [item.key]: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500/30"
                      />
                      <span className="text-sm text-zinc-400">{item.text}</span>
                    </label>
                  ))}
                </div>
              </div>

              <p className="text-center text-xs text-zinc-600 flex items-center justify-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Your progress is auto-saved. You can save as draft and return later before submitting.
              </p>
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="p-4 border-t border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={goPrev} disabled={currentStep === 0}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-all ${currentStep === 0 ? "text-zinc-700" : "text-zinc-400 hover:text-white"}`}>
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={handleSaveDraft} disabled={saveMutation.isPending}
              className="px-4 py-2 text-sm font-semibold text-zinc-500 hover:text-zinc-300 border border-zinc-700/50 rounded-lg transition-all flex items-center gap-2">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Draft"}
            </button>
          </div>

          {currentStep === steps.length - 1 ? (
            <button
              onClick={handleSubmit}
              disabled={!allConsented || submitMutation.isPending}
              className={`flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-lg transition-all shadow-lg ${
                allConsented
                  ? "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed shadow-none"
              }`}
            >
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4" /> Submit Application</>}
            </button>
          ) : (
            <button onClick={goNext}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
