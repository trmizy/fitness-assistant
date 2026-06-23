import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Shield, Briefcase, Award, Users, Calendar,
  Globe, CheckCircle, ChevronLeft, ChevronRight,
  Upload, X, Check, AlertCircle, Clock, FileText,
  Instagram, Youtube, Linkedin, ArrowLeft, Loader2,
  Facebook, Plus, Trash2, MapPin
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { ptApplicationService, PTApplication, PTApplicationCertificate } from "../../services/ptApplicationService";
import { formatVND } from "../../utils/currency";
import { locationService } from "../../services/api";

const inp = "w-full px-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 placeholder-zinc-600 transition-all";
const lbl = "text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold";

const steps = [
  { key: "personal", label: "Thông tin cá nhân", icon: User },
  { key: "identity", label: "Xác thực danh tính", icon: Shield },
  { key: "experience", label: "Kinh nghiệm", icon: Briefcase },
  { key: "certs", label: "Chứng chỉ", icon: Award },
  { key: "focus", label: "Hướng huấn luyện", icon: Users },
  { key: "availability", label: "Dịch vụ & Lịch", icon: Calendar },
  { key: "portfolio", label: "Portfolio", icon: Globe },
  { key: "review", label: "Xem lại & Nộp", icon: CheckCircle },
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
  not_applied: { label: "Chưa đăng ký", bg: "bg-zinc-700/50", text: "text-zinc-400", border: "border-zinc-700", dot: "bg-zinc-500", desc: "Bạn chưa đăng ký PT." },
  DRAFT: { label: "Bản nháp", bg: "bg-zinc-700/50", text: "text-zinc-400", border: "border-zinc-700", dot: "bg-zinc-400", desc: "Hồ sơ đã lưu dưới dạng nháp." },
  SUBMITTED: { label: "Đã nộp", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", dot: "bg-blue-500", desc: "Hồ sơ đã nộp, chờ admin xét duyệt." },
  UNDER_REVIEW: { label: "Đang xét duyệt", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", dot: "bg-amber-500", desc: "Admin đang xem xét hồ sơ của bạn." },
  NEEDS_MORE_INFO: { label: "Cần bổ sung thông tin", bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", dot: "bg-orange-500", desc: "Admin yêu cầu bổ sung thông tin." },
  APPROVED: { label: "Đã duyệt ✓", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20", dot: "bg-green-500", desc: "Chúc mừng! Hồ sơ PT của bạn đã được duyệt." },
  REJECTED: { label: "Từ chối", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-500", desc: "Hồ sơ của bạn không được chấp thuận lần này." },
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

const getFullUrl = (url: string) => {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  // @ts-ignore
  const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
  return `${baseUrl}${url}`;
};

function UploadBox({ label: labelText, hint, value, onUpload }: { label: string; hint?: string; value?: string; onUpload: (url: string) => void }) {
  const [isUploading, setIsUploading] = useState(false);


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
      alert("Tải lên thất bại. Vui lòng thử lại.");
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
            <span className="text-xs text-zinc-500">Đang tải lên...</span>
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
                  <p className="text-[10px] text-white font-bold uppercase tracking-wider">Đổi ảnh</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-semibold text-wrap">Đã tải lên</span>
              </div>
            )}
            <button
              type="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onUpload(""); }}
              className="px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-400 hover:text-red-400 text-[11px] font-medium transition-colors flex items-center gap-1.5"
            >
              <X className="w-3 h-3" /> Xóa tệp
            </button>
          </div>
        ) : (
          <div>
            <Upload className="w-6 h-6 text-zinc-600 mx-auto mb-1" />
            <p className="text-xs text-zinc-500">{hint || "Bấm để chọn hoặc kéo thả"}</p>
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
        <button type="button" onClick={onEdit} className="text-xs text-green-400 hover:text-green-300 font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Sửa
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
        {value || "Chưa nhập"}
      </span>
    </div>
  );
}

const emptyCert: PTApplicationCertificate = { certificateName: '', issuingOrganization: '', isCurrentlyValid: true, certificationStatus: 'Valid' };
const emptyTrainingLoc = { provinceCode: '', wardCode: '', gymName: '', addressLine: '', legacyDistrictName: '', isPrimary: false, note: '', wards: [] as { code: number; name: string }[] };

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
    availableDays: [],
    availabilityBlocks: [],
    sessionDurationMinutes: 60,
    certificates: [{ ...emptyCert }],
    media: [],
    applicationTrainingLocations: [],
  });

  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>([]);
  const [residenceWards, setResidenceWards] = useState<{ code: number; name: string }[]>([]);
  const [trainingLocations, setTrainingLocations] = useState([{ ...emptyTrainingLoc, isPrimary: true }]);

  const { data: appData, isLoading } = useQuery({
    queryKey: ['pt-application-me'],
    queryFn: () => ptApplicationService.getMe()
  });

  useEffect(() => {
    locationService.getProvinces().then(setProvinces).catch(() => {});
  }, []);

  useEffect(() => {
    if (appData) {
      setFormData(prev => ({
        ...prev,
        ...appData,
        mainSpecialties: appData.mainSpecialties || [],
        targetClientGroups: appData.targetClientGroups || [],
        primaryTrainingGoals: appData.primaryTrainingGoals || [],
        availableDays: appData.availableDays || [],
        availabilityBlocks: appData.availabilityBlocks || [],
        sessionDurationMinutes: appData.sessionDurationMinutes || 60,
        certificates: appData.certificates?.length > 0 ? appData.certificates : [{ ...emptyCert }],
        media: appData.media || [],
        applicationTrainingLocations: appData.applicationTrainingLocations || [],
      }));
      // Restore training location UI state from saved data
      if (appData.applicationTrainingLocations?.length) {
        const saved = appData.applicationTrainingLocations;
        setTrainingLocations(saved.map((loc, i) => ({
          provinceCode: String(loc.provinceCode ?? ''),
          wardCode: String(loc.wardCode ?? ''),
          gymName: loc.gymName ?? '',
          addressLine: loc.addressLine ?? '',
          legacyDistrictName: loc.legacyDistrictName ?? '',
          isPrimary: loc.isPrimary ?? (i === 0),
          note: loc.note ?? '',
          wards: [],
        })));
      }
      // Restore residence wards
      if (appData.residenceProvinceCode) {
        locationService.getWards(appData.residenceProvinceCode).then(setResidenceWards).catch(() => {});
      }
    }
  }, [appData]);

  const handleResidenceProvinceChange = async (code: string) => {
    updateField('residenceProvinceCode', code ? Number(code) : undefined);
    updateField('residenceWardCode', undefined);
    setResidenceWards(code ? await locationService.getWards(Number(code)).catch(() => []) : []);
  };

  const handleTrainingProvinceChange = async (idx: number, code: string) => {
    const updated = [...trainingLocations];
    updated[idx] = { ...updated[idx], provinceCode: code, wardCode: '', wards: [] };
    setTrainingLocations(updated);
    if (code) {
      const ws = await locationService.getWards(Number(code)).catch(() => []);
      setTrainingLocations(prev => { const u = [...prev]; u[idx] = { ...u[idx], wards: ws }; return u; });
    }
  };

  const updateTrainingLoc = (idx: number, field: string, value: any) => {
    setTrainingLocations(prev => { const u = [...prev]; u[idx] = { ...u[idx], [field]: value }; return u; });
  };

  const addTrainingLoc = () => setTrainingLocations(prev => [...prev, { ...emptyTrainingLoc }]);

  const removeTrainingLoc = (idx: number) => setTrainingLocations(prev => prev.filter((_, i) => i !== idx));

  const getValidTrainingLocations = () => {
    const valid = trainingLocations.filter(
      loc => loc.provinceCode && (loc.gymName.trim() || loc.addressLine.trim())
    );
    return valid.map((loc, i, arr) => ({
    provinceCode: Number(loc.provinceCode),
    wardCode: loc.wardCode ? Number(loc.wardCode) : undefined,
    gymName: loc.gymName.trim() || undefined,
    addressLine: loc.addressLine.trim() || undefined,
    legacyDistrictName: loc.legacyDistrictName.trim() || undefined,
    isPrimary: arr.findIndex(l => l.isPrimary) === i || i === 0,
    note: loc.note.trim() || undefined,
  }));
  };

  const saveMutation = useMutation({
    mutationFn: (data: Partial<PTApplication>) => ptApplicationService.saveDraft(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pt-application-me'] }),
    onError: (err: any) => {
      alert(err.response?.data?.error || err.message || 'Lưu thất bại. Vui lòng thử lại.');
    }
  });

  const submitMutation = useMutation({
    mutationFn: () => ptApplicationService.submit(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pt-application-me'] });
      alert("Nộp hồ sơ thành công!");
    },
    onError: (err: any) => {
      alert(err.response?.data?.error || "Nộp thất bại. Vui lòng kiểm tra các trường bắt buộc.");
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
    if (portfolioMedia.length >= 5) { alert("Tối đa 5 ảnh portfolio"); return; }
    setPortfolioUploading(true);
    try {
      const { url } = await ptApplicationService.uploadDocument(file);
      const media = [...(formData.media || [])];
      media.push({ groupType: 'PORTFOLIO', fileUrl: url, label: file.name });
      updateField('media', media);
    } catch (error) {
      console.error('Portfolio upload failed', error);
      alert("Tải lên thất bại. Vui lòng thử lại.");
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

  const handleSaveDraft = () => saveMutation.mutate({ ...formData, applicationTrainingLocations: getValidTrainingLocations() });
  const handleSubmit = () => {
    saveMutation.mutate(
      { ...formData, applicationTrainingLocations: getValidTrainingLocations() },
      { onSuccess: () => submitMutation.mutate() },
    );
  };

  const validateAvailability = () => {
    if (currentStep !== 5) return true;
    const blocks = formData.availabilityBlocks || [];
    if (blocks.length === 0) {
      alert("Vui lòng thêm ít nhất một khung giờ.");
      return false;
    }
    
    for (const block of blocks) {
      if (!block.startTime || !block.endTime) {
        alert("Vui lòng điền đầy đủ giờ bắt đầu và kết thúc cho tất cả khung giờ.");
        return false;
      }
      if (block.startTime >= block.endTime) {
        alert(`Giờ bắt đầu phải trước giờ kết thúc cho ${block.dayOfWeek}.`);
        return false;
      }
    }

    // Overlap check
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const day of days) {
      const dayBlocks = blocks.filter(b => b.dayOfWeek === day).sort((a,b) => a.startTime.localeCompare(b.startTime));
      for (let i = 0; i < dayBlocks.length - 1; i++) {
        if (dayBlocks[i].endTime > dayBlocks[i+1].startTime) {
          alert(`Phát hiện khung giờ trùng nhau vào ${day}. Vui lòng sửa trước khi tiếp tục.`);
          return false;
        }
      }
    }
    return true;
  };

  const goNext = () => {
    if (currentStep === 5 && !validateAvailability()) return;
    if (currentStep === 5) {
      const mode = formData.serviceMode;
      if ((mode === 'OFFLINE' || mode === 'HYBRID') && getValidTrainingLocations().length === 0) {
        alert('Dịch vụ Offline/Hybrid cần ít nhất 1 nơi luyện tập hợp lệ (chọn tỉnh/thành và tên phòng gym hoặc địa chỉ).');
        return;
      }
    }
    handleSaveDraft();
    setCurrentStep(s => Math.min(s + 1, steps.length - 1));
  };
  const goPrev = () => setCurrentStep(s => Math.max(s - 1, 0));

  const allConsented = consent.accurate && consent.reviewConsent && consent.falseInfoWarning && consent.termsAgreed;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black">
        <Loader2 className="w-10 h-10 text-green-500 animate-spin mb-4" />
        <p className="text-zinc-400">Đang tải hồ sơ của bạn...</p>
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
            {status === 'APPROVED' ? "Hồ sơ đã được duyệt!" : "Hồ sơ đang xét duyệt"}
          </h2>
          <p className="text-zinc-400 text-sm mb-1">{appStatusConfig[status].desc}</p>
          {status !== 'APPROVED' && <p className="text-zinc-600 text-xs mb-6">Thường được xét duyệt trong 2–5 ngày làm việc.</p>}

          <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-xl p-4 mb-6 text-left space-y-3">
            {["SUBMITTED", "UNDER_REVIEW", "APPROVED"].map((s) => {
              const cfg = appStatusConfig[s];
              const order = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];
              const done = order.indexOf(s) <= order.indexOf(status);

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
            <button type="button" onClick={() => navigate("/client/profile")} className="px-5 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-lg hover:bg-zinc-700 transition-colors">Về trang cá nhân</button>
            <button type="button" onClick={() => navigate("/client/dashboard")} className="px-5 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">Về Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate("/client/profile")} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-zinc-100 font-bold text-xl">Đăng ký trở thành PT</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Hoàn thành tất cả các mục để nộp hồ sơ cho admin xét duyệt</p>
        </div>
      </div>

      {/* NEEDS_MORE_INFO / REJECTED banner */}
      {status === 'NEEDS_MORE_INFO' && formData.adminNote && (
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-orange-400">Yêu cầu bổ sung thông tin</p>
            <p className="text-xs text-zinc-400 mt-1">{formData.adminNote}</p>
          </div>
        </div>
      )}
      {status === 'REJECTED' && formData.rejectionReason && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-400">Hồ sơ bị từ chối</p>
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
              <button type="button" key={s.key} onClick={() => { saveMutation.mutate(formData); setCurrentStep(i); }}
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
          <span>Bước {currentStep + 1} / {steps.length}</span>
          <span>Hoàn thành {Math.round((currentStep / (steps.length - 1)) * 100)}%</span>
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
                  <label htmlFor="pta-phone" className={lbl}>Số điện thoại</label>
                  <input id="pta-phone" type="tel" className={inp} placeholder="+84 ..." value={formData.phoneNumber || ""} onChange={e => updateField("phoneNumber", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="pta-national-id" className={lbl}>CMND / Hộ chiếu</label>
                  <input id="pta-national-id" type="text" className={inp} placeholder="Số CMND/Hộ chiếu..." value={formData.nationalIdNumber || ""} onChange={e => updateField("nationalIdNumber", e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="pta-current-address" className={lbl}>Địa chỉ hiện tại</label>
                <input id="pta-current-address" type="text" className={inp} placeholder="Số nhà, Thành phố, Quốc gia..." value={formData.currentAddress || ""} onChange={e => updateField("currentAddress", e.target.value)} />
              </div>

              <div className="border-t border-zinc-800/60 pt-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3 font-semibold flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5" /> Địa chỉ nơi cư trú (chỉ admin thấy)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pta-residence-province" className={lbl}>Tỉnh/Thành phố</label>
                    <select id="pta-residence-province" className={inp} value={formData.residenceProvinceCode ?? ''} onChange={e => handleResidenceProvinceChange(e.target.value)}>
                      <option value="">-- Chọn tỉnh/thành --</option>
                      {provinces.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pta-residence-ward" className={lbl}>Phường/Xã</label>
                    <select id="pta-residence-ward" className={inp} value={formData.residenceWardCode ?? ''} onChange={e => updateField('residenceWardCode', e.target.value ? Number(e.target.value) : undefined)} disabled={!formData.residenceProvinceCode}>
                      <option value="">-- Chọn phường/xã --</option>
                      {residenceWards.map(w => <option key={w.code} value={w.code}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pta-residence-address-line" className={lbl}>Địa chỉ chi tiết</label>
                    <input id="pta-residence-address-line" type="text" className={inp} placeholder="Số nhà, tên đường..." maxLength={255} value={formData.residenceAddressLine || ''} onChange={e => updateField('residenceAddressLine', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="pta-residence-district" className={lbl}>Quận/Huyện (nếu cần)</label>
                    <input id="pta-residence-district" type="text" className={inp} placeholder="VD: Quận Bình Thạnh" value={formData.residenceLegacyDistrictName || ''} onChange={e => updateField('residenceLegacyDistrictName', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Identity (PRESERVED) ── */}
          {currentStep === 1 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-500/80 leading-relaxed">
                  Chúng tôi cần xác thực danh tính. Vui lòng tải ảnh rõ ràng CMND (trước & sau) và ảnh chân dung gần đây.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UploadBox label="CMND (Mặt trước)" value={formData.idCardFrontUrl} onUpload={url => updateField("idCardFrontUrl", url)} />
                <UploadBox label="CMND (Mặt sau)" value={formData.idCardBackUrl} onUpload={url => updateField("idCardBackUrl", url)} />
              </div>
              <UploadBox label="Ảnh chân dung" value={formData.portraitPhotoUrl} onUpload={url => updateField("portraitPhotoUrl", url)} />
            </div>
          )}

          {/* ── STEP 3: Professional Experience ── */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Briefcase className="w-4 h-4 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Lý lịch chuyên môn</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pta-years-exp" className={lbl}>Số năm kinh nghiệm PT *</label>
                  <select id="pta-years-exp" className={inp} value={formData.yearsOfExperience || ""} onChange={e => updateField("yearsOfExperience", e.target.value)}>
                    <option value="">Chọn kinh nghiệm...</option>
                    <option value="<1">Dưới 1 năm</option>
                    <option value="1-3">1 - 3 năm</option>
                    <option value="3-5">3 - 5 năm</option>
                    <option value="5-10">5 - 10 năm</option>
                    <option value="10+">Hơn 10 năm</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="pta-education" className={lbl}>Trình độ học vấn *</label>
                <input id="pta-education" type="text" className={inp} placeholder="VD: Cử nhân Khoa học Thể thao, Đại học TDTT" value={formData.educationBackground || ""} onChange={e => updateField("educationBackground", e.target.value)} />
              </div>

              <div>
                <label htmlFor="pta-work-experience" className={lbl}>Kinh nghiệm làm việc</label>
                <textarea id="pta-work-experience" className={`${inp} min-h-[100px] resize-none`} placeholder="Mô tả các vị trí bạn đã làm, phòng gym, hoặc học viên bạn đã huấn luyện..." value={formData.previousWorkExperience || ""} onChange={e => updateField("previousWorkExperience", e.target.value)} />
              </div>

              <div>
                <p className={lbl}>Chuyên môn chính * (Chọn tất cả phù hợp)</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {specialtyOptions.map(opt => (
                    <Chip key={opt} label={opt} active={formData.mainSpecialties?.includes(opt) || false} onClick={() => toggle("mainSpecialties", opt)} />
                  ))}
                </div>
                {(!formData.mainSpecialties || formData.mainSpecialties.length === 0) && (
                  <p className="text-xs text-zinc-600 mt-1.5">Chọn ít nhất một chuyên môn</p>
                )}
              </div>

              <div>
                <label htmlFor="pta-professional-bio" className={lbl}>Giới thiệu bản thân *</label>
                <textarea id="pta-professional-bio" className={`${inp} min-h-[120px] resize-none`} placeholder="Mô tả triết lý huấn luyện, phong cách và điểm khác biệt của bạn... (tối thiểu 100 ký tự)" value={formData.professionalBio || ""} onChange={e => updateField("professionalBio", e.target.value)} />
                <p className="text-xs text-zinc-600 mt-1">{(formData.professionalBio || "").length}/100 ký tự tối thiểu</p>
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
                <h3 className="text-base font-bold text-zinc-200">Chứng chỉ & Bằng cấp</h3>
              </div>

              {(formData.certificates || []).map((cert, index) => (
                <div key={cert.id ?? String(index)} className="border border-zinc-700/50 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-zinc-300 uppercase tracking-wide">Chứng chỉ {index + 1}</h4>
                    <div className="flex items-center gap-2">
                      {index > 0 && (
                        <>
                          <span className="text-[10px] text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">Tùy chọn</span>
                          <button type="button" onClick={() => removeCertificate(index)} className="text-zinc-600 hover:text-red-400 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={`pta-cert-name-${index}`} className={lbl}>Tên chứng chỉ {index === 0 ? '*' : ''}</label>
                      <input id={`pta-cert-name-${index}`} type="text" aria-label={`Tên chứng chỉ ${index + 1}`} className={inp} placeholder="VD: NASM Certified Personal Trainer" value={cert.certificateName || ""} onChange={e => updateCertificate(index, 'certificateName', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor={`pta-cert-org-${index}`} className={lbl}>Tổ chức cấp {index === 0 ? '*' : ''}</label>
                      <input id={`pta-cert-org-${index}`} type="text" aria-label={`Tổ chức cấp chứng chỉ ${index + 1}`} className={inp} placeholder="VD: NASM, ACE, ISSA, CSCS" value={cert.issuingOrganization || ""} onChange={e => updateCertificate(index, 'issuingOrganization', e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={`pta-cert-issue-date-${index}`} className={lbl}>Ngày cấp {index === 0 ? '*' : ''}</label>
                      <input id={`pta-cert-issue-date-${index}`} type="date" aria-label={`Ngày cấp chứng chỉ ${index + 1}`} className={inp} value={cert.issueDate ? cert.issueDate.substring(0, 10) : ""} onChange={e => updateCertificate(index, 'issueDate', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor={`pta-cert-exp-date-${index}`} className={lbl}>Ngày hết hạn</label>
                      <input id={`pta-cert-exp-date-${index}`} type="date" aria-label={`Ngày hết hạn chứng chỉ ${index + 1}`} className={inp} value={cert.expirationDate ? cert.expirationDate.substring(0, 10) : ""} onChange={e => updateCertificate(index, 'expirationDate', e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <p className={lbl}>Trạng thái chứng chỉ {index === 0 ? '*' : ''}</p>
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
                    label={`Tài liệu / Ảnh chứng chỉ ${index === 0 ? '*' : '(Tùy chọn)'}`}
                    hint="JPG, PNG hoặc PDF · Tối đa 10MB"
                    value={cert.certificateFileUrl}
                    onUpload={url => updateCertificate(index, 'certificateFileUrl', url)}
                  />
                </div>
              ))}

              <button type="button" onClick={addCertificate}
                className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-zinc-700 rounded-xl text-sm text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-all">
                <Plus className="w-4 h-4" /> Thêm chứng chỉ
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
                <h3 className="text-base font-bold text-zinc-200">Hướng huấn luyện & Đối tượng mục tiêu</h3>
              </div>

              <div>
                <p className={lbl}>Nhóm học viên mục tiêu * (Chọn tất cả phù hợp)</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {targetOptions.map(opt => (
                    <Chip key={opt} label={opt} active={formData.targetClientGroups?.includes(opt) || false} onClick={() => toggle("targetClientGroups", opt)} />
                  ))}
                </div>
              </div>

              <div>
                <p className={lbl}>Mục tiêu huấn luyện chính *</p>
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
                <label htmlFor="pta-training-methods" className={lbl}>Phương pháp & Cách tiếp cận</label>
                <textarea id="pta-training-methods" className={`${inp} min-h-[100px] resize-none`} placeholder="Mô tả cách bạn cấu trúc buổi tập, phong cách huấn luyện và những gì học viên có thể mong đợi..." value={formData.trainingMethodsApproach || ""} onChange={e => updateField("trainingMethodsApproach", e.target.value)} />
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
                <h3 className="text-base font-bold text-zinc-200">Dịch vụ & Lịch làm việc</h3>
              </div>

              <div>
                <p className={lbl}>Thời lượng buổi tập *</p>
                <div className="grid grid-cols-4 gap-3 mt-1">
                  {[30, 45, 60, 90].map(mins => (
                    <button key={mins} type="button" onClick={() => updateField("sessionDurationMinutes", mins)}
                      className={`py-2 rounded-lg border text-xs font-bold transition-all ${formData.sessionDurationMinutes === mins
                          ? "bg-green-500/15 border-green-500/40 text-green-400"
                          : "bg-zinc-800/40 border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                        }`}>
                      {mins} min
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-600 mt-2 italic">Chọn thời gian của một buổi tập tiêu chuẩn.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className={lbl}>Lịch làm việc hàng tuần *</p>
                  <button type="button" 
                    onClick={() => {
                      const current = formData.availabilityBlocks || [];
                      updateField("availabilityBlocks", [...current, { dayOfWeek: "Mon", startTime: "08:00", endTime: "12:00" }]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-green-400 hover:bg-zinc-700 transition-all">
                    <Plus className="w-3.5 h-3.5" /> Thêm khung giờ
                  </button>
                </div>

                <div className="space-y-3">
                  {(formData.availabilityBlocks || []).map((block: any, idx: number) => (
                    <div key={block.dayOfWeek ? `${block.dayOfWeek}-${block.startTime}-${idx}` : idx} className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-3 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[100px]">
                        <select aria-label={`Ngày trong tuần (khung giờ ${idx + 1})`} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none"
                          value={block.dayOfWeek}
                          onChange={(e) => {
                            const blocks = [...(formData.availabilityBlocks || [])];
                            blocks[idx].dayOfWeek = e.target.value;
                            updateField("availabilityBlocks", blocks);
                          }}>
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <input aria-label={`Giờ bắt đầu (khung giờ ${idx + 1})`} type="time" className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
                          value={block.startTime}
                          onChange={(e) => {
                            const blocks = [...(formData.availabilityBlocks || [])];
                            blocks[idx].startTime = e.target.value;
                            updateField("availabilityBlocks", blocks);
                          }}
                        />
                        <span className="text-zinc-600">đến</span>
                        <input aria-label={`Giờ kết thúc (khung giờ ${idx + 1})`} type="time" className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
                          value={block.endTime}
                          onChange={(e) => {
                            const blocks = [...(formData.availabilityBlocks || [])];
                            blocks[idx].endTime = e.target.value;
                            updateField("availabilityBlocks", blocks);
                          }}
                        />
                      </div>
                      <button type="button" 
                        onClick={() => {
                          const blocks = [...(formData.availabilityBlocks || [])];
                          blocks.splice(idx, 1);
                          updateField("availabilityBlocks", blocks);
                        }}
                        className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {(formData.availabilityBlocks || []).length === 0 && (
                    <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl">
                      <Clock className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                      <p className="text-xs text-zinc-600">Chưa thêm khung giờ nào.</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="pta-gym-affiliation" className={lbl}>Phòng gym / Cơ sở</label>
                <input id="pta-gym-affiliation" type="text" className={inp} placeholder="VD: California Fitness, freelance" value={formData.gymAffiliation || ""} onChange={e => updateField("gymAffiliation", e.target.value)} />
              </div>

              <div>
                <p className={lbl}>Hình thức dịch vụ *</p>
                <div className="grid grid-cols-3 gap-3 mt-1">
                  {([
                    { val: 'ONLINE', label: 'Online qua video call' },
                    { val: 'OFFLINE', label: 'Offline tại phòng gym' },
                    { val: 'HYBRID', label: 'Cả online và offline' },
                  ] as const).map(opt => (
                    <button key={opt.val} type="button" onClick={() => updateField("serviceMode", opt.val)}
                      className={`py-2.5 px-3 rounded-lg border text-xs font-bold transition-all text-center ${formData.serviceMode === opt.val
                        ? "bg-green-500/15 border-green-500/40 text-green-400"
                        : "bg-zinc-800/40 border-zinc-700/50 text-zinc-500 hover:border-zinc-600"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className={lbl}>Giá dịch vụ *</p>
                {!formData.serviceMode ? (
                  <p className="text-xs text-zinc-600 italic mt-1">Chọn hình thức dịch vụ ở trên để nhập giá</p>
                ) : (
                  <div className="space-y-4 mt-1">
                    {(formData.serviceMode === 'ONLINE' || formData.serviceMode === 'HYBRID') && (
                      <div>
                        <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider mb-2">Giá Online qua video call</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Giá theo buổi (VND) *</p>
                            <input aria-label="Giá online theo buổi (VND)" type="number" className={inp} placeholder="VD: 500" value={formData.onlinePricePerSession ?? ""} onChange={e => updateField("onlinePricePerSession", e.target.value ? parseFloat(e.target.value) : null)} />
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Giá gói (VND)</p>
                            <input aria-label="Giá gói online (VND)" type="number" className={inp} placeholder="VD: 4500" value={formData.onlinePackagePrice ?? ""} onChange={e => updateField("onlinePackagePrice", e.target.value ? parseFloat(e.target.value) : null)} />
                          </div>
                        </div>
                      </div>
                    )}
                    {(formData.serviceMode === 'OFFLINE' || formData.serviceMode === 'HYBRID') && (
                      <div>
                        <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider mb-2">Giá Offline tại phòng gym</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Giá theo buổi (VND) *</p>
                            <input aria-label="Giá offline theo buổi (VND)" type="number" className={inp} placeholder="VD: 800" value={formData.offlinePricePerSession ?? ""} onChange={e => updateField("offlinePricePerSession", e.target.value ? parseFloat(e.target.value) : null)} />
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Giá gói (VND)</p>
                            <input aria-label="Giá gói offline (VND)" type="number" className={inp} placeholder="VD: 7000" value={formData.offlinePackagePrice ?? ""} onChange={e => updateField("offlinePackagePrice", e.target.value ? parseFloat(e.target.value) : null)} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-zinc-600 mb-1">Buổi trong gói</p>
                        <input aria-label="Số buổi trong gói" type="number" className={inp} placeholder="VD: 10" value={formData.sessionsPerPackage ?? ""} onChange={e => updateField("sessionsPerPackage", e.target.value ? parseInt(e.target.value) : null)} />
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 mb-1">Gói tháng (VND)</p>
                        <input aria-label="Giá gói tháng (VND)" type="number" className={inp} placeholder="VD: 3500" value={formData.monthlyProgramPrice ?? ""} onChange={e => updateField("monthlyProgramPrice", e.target.value ? parseFloat(e.target.value) : null)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="pta-pricing-notes" className={lbl}>Ghi chú thêm về giá</label>
                <textarea id="pta-pricing-notes" className={`${inp} min-h-[80px] resize-none`} placeholder="Giảm giá, gói đặc biệt, buổi thử..." value={formData.additionalPricingNotes || ""} onChange={e => updateField("additionalPricingNotes", e.target.value)} />
              </div>

              {/* Training locations */}
              {(formData.serviceMode === 'OFFLINE' || formData.serviceMode === 'HYBRID') && (
                <div className="border-t border-zinc-800/60 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5" /> Nơi luyện tập *
                    </p>
                    <button type="button" onClick={addTrainingLoc} className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-green-400 hover:bg-zinc-700 transition-all">
                      <Plus className="w-3.5 h-3.5" /> Thêm địa điểm
                    </button>
                  </div>
                  <div className="space-y-4">
                    {trainingLocations.map((loc, idx) => (
                      <div key={loc.provinceCode ? `${loc.provinceCode}-${loc.gymName}-${idx}` : idx} className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-zinc-400">Địa điểm {idx + 1}{loc.isPrimary ? ' · Chính' : ''}</span>
                          <div className="flex items-center gap-2">
                            {!loc.isPrimary && (
                              <button type="button" onClick={() => { setTrainingLocations(prev => prev.map((l, i) => ({ ...l, isPrimary: i === idx }))); }} className="text-[11px] text-zinc-500 hover:text-green-400 transition-colors">Đặt làm chính</button>
                            )}
                            {idx > 0 && (
                              <button type="button" onClick={() => removeTrainingLoc(idx)} className="text-zinc-600 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`pta-loc-province-${idx}`} className={lbl}>Tỉnh/Thành phố *</label>
                            <select id={`pta-loc-province-${idx}`} className={inp} value={loc.provinceCode} onChange={e => handleTrainingProvinceChange(idx, e.target.value)}>
                              <option value="">-- Chọn tỉnh/thành --</option>
                              {provinces.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                            </select>
                          </div>
                          {loc.wards.length > 0 && (
                            <div>
                              <label htmlFor={`pta-loc-ward-${idx}`} className={lbl}>Phường/Xã</label>
                              <select id={`pta-loc-ward-${idx}`} className={inp} value={loc.wardCode} onChange={e => updateTrainingLoc(idx, 'wardCode', e.target.value)}>
                                <option value="">-- Chọn phường/xã --</option>
                                {loc.wards.map(w => <option key={w.code} value={w.code}>{w.name}</option>)}
                              </select>
                            </div>
                          )}
                          <div>
                            <label htmlFor={`pta-loc-gym-name-${idx}`} className={lbl}>Tên phòng gym</label>
                            <input id={`pta-loc-gym-name-${idx}`} type="text" aria-label={`Tên phòng gym ${idx + 1}`} className={inp} placeholder="VD: California Fitness" maxLength={120} value={loc.gymName} onChange={e => updateTrainingLoc(idx, 'gymName', e.target.value)} />
                          </div>
                          <div>
                            <label htmlFor={`pta-loc-address-${idx}`} className={lbl}>Địa chỉ chi tiết</label>
                            <input id={`pta-loc-address-${idx}`} type="text" aria-label={`Địa chỉ chi tiết ${idx + 1}`} className={inp} placeholder="Số nhà, tên đường..." maxLength={255} value={loc.addressLine} onChange={e => updateTrainingLoc(idx, 'addressLine', e.target.value)} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 7: Portfolio & Social ── */}
          {currentStep === 6 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-pink-400" />
                </div>
                <h3 className="text-base font-bold text-zinc-200">Portfolio & Thương hiệu cá nhân</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pta-linkedin" className={lbl}>
                    <Linkedin className="inline w-3.5 h-3.5 mr-1.5 text-blue-400" />
                    LinkedIn Profile
                  </label>
                  <input id="pta-linkedin" type="url" className={inp} placeholder="https://linkedin.com/in/yourname" value={formData.linkedinUrl || ""} onChange={e => updateField("linkedinUrl", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="pta-website" className={lbl}>
                    <Globe className="inline w-3.5 h-3.5 mr-1.5 text-green-400" />
                    Website cá nhân / Portfolio
                  </label>
                  <input id="pta-website" type="url" className={inp} placeholder="https://yourwebsite.com" value={formData.websiteUrl || ""} onChange={e => updateField("websiteUrl", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pta-instagram" className={lbl}>
                    <Instagram className="inline w-3.5 h-3.5 mr-1.5 text-pink-400" />
                    Instagram
                  </label>
                  <input id="pta-instagram" type="text" className={inp} placeholder="@your_handle" value={formData.socialLinks?.instagram || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, instagram: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="pta-facebook" className={lbl}>
                    <Facebook className="inline w-3.5 h-3.5 mr-1.5 text-blue-500" />
                    Facebook Page
                  </label>
                  <input id="pta-facebook" type="text" className={inp} placeholder="facebook.com/yourpage" value={formData.socialLinks?.facebook || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, facebook: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pta-tiktok" className={lbl}>
                    <svg className="inline w-3.5 h-3.5 mr-1.5 text-cyan-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.06a6.27 6.27 0 00-.79-.05A6.34 6.34 0 003.15 15.5a6.27 6.27 0 006.34 6.34 6.21 6.21 0 004.49-1.92 6.34 6.34 0 001.85-4.42V8.87a8.16 8.16 0 004.76 1.52V6.94a4.83 4.83 0 01-1-.25z" /></svg>
                    TikTok
                  </label>
                  <input id="pta-tiktok" type="text" className={inp} placeholder="@your_tiktok" value={formData.socialLinks?.tiktok || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, tiktok: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="pta-youtube" className={lbl}>
                    <Youtube className="inline w-3.5 h-3.5 mr-1.5 text-red-500" />
                    YouTube
                  </label>
                  <input id="pta-youtube" type="text" className={inp} placeholder="youtube.com/@yourchannel" value={formData.socialLinks?.youtube || ""} onChange={e => updateField("socialLinks", { ...formData.socialLinks, youtube: e.target.value })} />
                </div>
              </div>

              {/* Portfolio Images */}
              <div>
                <label htmlFor="pta-portfolio-upload" className={lbl}>Ảnh Portfolio / Trước & Sau (Tùy chọn)</label>
                <label htmlFor="pta-portfolio-upload" className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  portfolioMedia.length > 0 ? "border-green-500/30 bg-green-500/5" : "border-zinc-700 hover:border-green-500/40 hover:bg-zinc-800/40"
                }`}>
                  <input id="pta-portfolio-upload" type="file" accept="image/*" className="hidden" onChange={handlePortfolioUpload} disabled={portfolioUploading} />
                  {portfolioUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
                      <span className="text-xs text-zinc-500">Đang tải lên...</span>
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
                      <div key={m.name ?? m.fileUrl ?? i} className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-xs text-zinc-300">{m.label || `Ảnh portfolio ${i + 1}`}</span>
                        </div>
                        <button type="button" onClick={() => removePortfolioImage(i)} className="text-zinc-600 hover:text-red-400">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="pta-other-references" className={lbl}>Link hoặc tài liệu tham khảo khác</label>
                <textarea id="pta-other-references" className={`${inp} min-h-[80px] resize-none`} placeholder="Testimonial học viên, media, kết quả thi đấu..." value={formData.otherReferences || ""} onChange={e => updateField("otherReferences", e.target.value)} />
              </div>
            </div>
          )}

          {/* ── STEP 8: Review & Submit ── */}
          {currentStep === 7 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 flex gap-3">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Kiểm tra thông tin trước khi nộp. Bạn có thể quay lại bất kỳ bước nào để chỉnh sửa.
                </p>
              </div>

              {/* Personal Information */}
              <ReviewSection icon={<User className="w-4 h-4 text-green-400" />} title="Thông tin cá nhân" onEdit={() => setCurrentStep(0)}>
                <ReviewRow label="Họ tên" value={user ? `${user.firstName} ${user.lastName}` : undefined} />
                <ReviewRow label="Điện thoại" value={formData.phoneNumber} />
                <ReviewRow label="Địa chỉ" value={formData.currentAddress} />
                <ReviewRow label="Email" value={user?.email} />
              </ReviewSection>

              {/* Identity & Verification */}
              <ReviewSection icon={<Shield className="w-4 h-4 text-cyan-400" />} title="Xác thực danh tính" onEdit={() => setCurrentStep(1)}>
                <ReviewRow label="CMND" value={formData.nationalIdNumber ? `${formData.nationalIdNumber} (đã nhập)` : undefined} />
                <ReviewRow label="Mặt trước" value={formData.idCardFrontUrl ? "✓ Đã tải" : undefined} isStatus />
                <ReviewRow label="Mặt sau" value={formData.idCardBackUrl ? "✓ Đã tải" : undefined} isStatus />
                <ReviewRow label="Chân dung" value={formData.portraitPhotoUrl ? "✓ Đã tải" : undefined} isStatus />
              </ReviewSection>

              {/* Professional Experience */}
              <ReviewSection icon={<Briefcase className="w-4 h-4 text-amber-400" />} title="Kinh nghiệm chuyên môn" onEdit={() => setCurrentStep(2)}>
                <ReviewRow label="Kinh nghiệm" value={formData.yearsOfExperience} />
                <ReviewRow label="Học vấn" value={formData.educationBackground} />
                <ReviewRow label="Chuyên môn" value={formData.mainSpecialties?.length ? formData.mainSpecialties.join(", ") : "Chưa chọn"} />
              </ReviewSection>

              {/* Certifications */}
              <ReviewSection icon={<Award className="w-4 h-4 text-purple-400" />} title="Chứng chỉ" onEdit={() => setCurrentStep(3)}>
                {(formData.certificates || []).flatMap((cert, i) => cert.certificateName ? [
                  <div key={cert.id ?? String(i)}>
                    <ReviewRow label={`Chứng chỉ ${i + 1}`} value={`${cert.certificateName} (${cert.certificationStatus || 'Valid'})`} />
                    <ReviewRow label="Tệp" value={cert.certificateFileUrl ? "✓ Đã tải" : "Chưa tải"} isStatus />
                  </div>
                ] : [])}
                {(!formData.certificates || formData.certificates.filter(c => c.certificateName).length === 0) && (
                  <ReviewRow label="Chứng chỉ" value="Chưa thêm" />
                )}
              </ReviewSection>

              {/* Coaching Focus */}
              <ReviewSection icon={<Users className="w-4 h-4 text-blue-400" />} title="Hướng huấn luyện" onEdit={() => setCurrentStep(4)}>
                <ReviewRow label="Đối tượng" value={formData.targetClientGroups?.length ? formData.targetClientGroups.join(", ") : "Chưa chọn"} />
                <ReviewRow label="Mục tiêu" value={formData.primaryTrainingGoals?.length ? formData.primaryTrainingGoals.join(", ") : "Chưa chọn"} />
              </ReviewSection>

              {/* Service & Availability */}
              <ReviewSection icon={<Calendar className="w-4 h-4 text-teal-400" />} title="Dịch vụ & Lịch" onEdit={() => setCurrentStep(5)}>
                <ReviewRow label="Thời lượng" value={`${formData.sessionDurationMinutes || 60} phút`} />
                <ReviewRow label="Hình thức" value={
                  formData.serviceMode === 'ONLINE' ? 'Online qua video call'
                  : formData.serviceMode === 'OFFLINE' ? 'Offline tại phòng gym'
                  : formData.serviceMode === 'HYBRID' ? 'Cả online và offline'
                  : undefined
                } />
                <div className="mt-1 space-y-1 pl-4 border-l border-zinc-700/50">
                  <p className="text-[10px] text-zinc-600 uppercase font-bold">Khung giờ tuần</p>
                  {(formData.availabilityBlocks || []).map((b: any, i: number) => (
                    <div key={b.dayOfWeek ? `${b.dayOfWeek}-${b.startTime}-${i}` : i} className="flex justify-between text-xs py-0.5">
                      <span className="text-zinc-500">{b.dayOfWeek}</span>
                      <span className="text-zinc-300 font-medium">{b.startTime} - {b.endTime}</span>
                    </div>
                  ))}
                  {(formData.availabilityBlocks || []).length === 0 && <p className="text-xs text-zinc-600">Chưa có khung giờ</p>}
                </div>
                {(formData.serviceMode === 'ONLINE' || formData.serviceMode === 'HYBRID') && (
                  <ReviewRow label="Giá Online / buổi" value={formData.onlinePricePerSession ? formatVND(Number(formData.onlinePricePerSession)) : undefined} />
                )}
                {(formData.serviceMode === 'OFFLINE' || formData.serviceMode === 'HYBRID') && (
                  <ReviewRow label="Giá Offline / buổi" value={formData.offlinePricePerSession ? formatVND(Number(formData.offlinePricePerSession)) : undefined} />
                )}
                {!formData.serviceMode && (
                  <ReviewRow label="Giá" value={formData.desiredSessionPrice ? `${formatVND(Number(formData.desiredSessionPrice))} / buổi` : undefined} />
                )}
                {formData.sessionsPerPackage && <ReviewRow label="Buổi trong gói" value={`${formData.sessionsPerPackage} buổi`} />}
              </ReviewSection>

              {/* Declaration & Consent */}
              <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-zinc-700/30 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-zinc-400" />
                  </div>
                  <h4 className="text-sm font-bold text-zinc-200">Cam kết & Đồng ý</h4>
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'accurate' as const, text: 'Tất cả thông tin cung cấp là chính xác và trung thực theo hiểu biết của tôi.' },
                    { key: 'reviewConsent' as const, text: 'Tôi đồng ý để admin Gymnini xem xét thông tin danh tính và nghề nghiệp của tôi.' },
                    { key: 'falseInfoWarning' as const, text: 'Tôi hiểu rằng cung cấp thông tin sai có thể dẫn đến cấm tài khoản vĩnh viễn.' },
                    { key: 'termsAgreed' as const, text: "Tôi đồng ý với Điều khoản dịch vụ và Quy tắc ứng xử của Huấn luyện viên Gymnini." },
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
                Tiến trình được tự động lưu. Bạn có thể lưu nháp và quay lại sau.
              </p>
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="p-4 border-t border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} disabled={currentStep === 0}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-all ${currentStep === 0 ? "text-zinc-700" : "text-zinc-400 hover:text-white"}`}>
              <ChevronLeft className="w-4 h-4" /> Quay lại
            </button>
            <button type="button" onClick={handleSaveDraft} disabled={saveMutation.isPending}
              className="px-4 py-2 text-sm font-semibold text-zinc-500 hover:text-zinc-300 border border-zinc-700/50 rounded-lg transition-all flex items-center gap-2">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Lưu nháp"}
            </button>
          </div>

          {currentStep === steps.length - 1 ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allConsented || submitMutation.isPending}
              className={`flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-lg transition-all shadow-lg ${
                allConsented
                  ? "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed shadow-none"
              }`}
            >
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4" /> Nộp hồ sơ</>}
            </button>
          ) : (
            <button type="button" onClick={goNext}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
              Tiếp theo <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
