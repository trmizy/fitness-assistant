import { useState, useRef, useEffect } from "react";
import {
  AreaChart, Area, BarChart, Bar, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import {
  Upload, CheckCircle, Clock, AlertCircle, XCircle, Eye,
  TrendingDown, TrendingUp, ChevronRight, FileImage, RefreshCw,
  Check, Activity, ClipboardList, Camera, ArrowRight, BarChart2,
  History, GitCompare, Plus, Loader2
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inbodyService } from "../../services/api";

/* ── Types & config ──────────────────────────────────────── */
type Tab = "overview" | "manual" | "upload" | "history" | "compare";
type UploadStep = "drop" | "preview" | "processing" | "review" | "done" | "failed";
type ManualStep = "form" | "done";

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType; dot: string }> = {
  extracted:     { label: "Đã trích xuất",     color: "bg-green-500/10 text-green-400 border-green-500/20",  icon: CheckCircle, dot: "bg-green-500"  },
  processing:    { label: "Đang xử lý",        color: "bg-blue-500/10 text-blue-400 border-blue-500/20",    icon: RefreshCw,   dot: "bg-blue-500"   },
  uploaded:      { label: "Đã tải lên",        color: "bg-zinc-700/50 text-zinc-400 border-zinc-700",       icon: FileImage,   dot: "bg-zinc-500"   },
  needs_confirm: { label: "Cần xác nhận",      color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: AlertCircle, dot: "bg-amber-500"  },
  manual:        { label: "Nhập thủ công",     color: "bg-violet-500/10 text-violet-400 border-violet-500/20", icon: ClipboardList, dot: "bg-violet-500" },
  failed:        { label: "Trích xuất thất bại", color: "bg-red-500/10 text-red-400 border-red-500/20",     icon: XCircle,     dot: "bg-red-500"    },
};

const tooltipStyle = {
  contentStyle: {
    fontSize: 12, borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#111111",
    color: "#f4f4f5",
  },
};

/* ── Helper: section card ─────────────────────────────────── */
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
      <h4 className="text-sm font-semibold text-zinc-200 mb-3">{title}</h4>
      {children}
    </div>
  );
}

/* ── Input style ─────────────────────────────────────────── */
const inp = "w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 transition-all";

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════ */
export function InBodyModule() {
  const queryClient = useQueryClient();
  const [tab, setTab]               = useState<Tab>("overview");
  const [uploadStep, setUploadStep] = useState<UploadStep>("drop");
  const [manualStep, setManualStep] = useState<ManualStep>("form");
  const [dragOver, setDragOver]     = useState(false);
  const [compareA, setCompareA]     = useState(0);
  const [compareB, setCompareB]     = useState(1);
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [reviewDate, setReviewDate] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper: display measurement date from record (use dateOnly slice to avoid TZ issues)
  const formatMeasurementDate = (r: any): string => {
    const raw: string | undefined = r.dateOnly ?? r.date;
    if (!raw) return '--';
    const ymd = String(raw).slice(0, 10); // "2024-06-10"
    const parts = ymd.split('-');
    if (parts.length !== 3) return ymd;
    return `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
  };

  // Queries
  const { data: history = [], isLoading } = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: inbodyService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbody-history"] });
      setManualStep("done");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: inbodyService.upload,
    onSuccess: (data) => {
      setExtractedData(data.entryData);
      // If OCR extracted a measurement date, pre-fill it; else default to today
      const ocrDate = data.entryData?.date;
      const defaultDate = ocrDate
        ? String(ocrDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      setReviewDate(defaultDate);
      setUploadStep("review");
    },
    onError: () => {
      setUploadStep("failed");
    },
  });

  const latest = history[0] || { weight: 0, muscleMass: 0, bodyFat: 0, bodyFatPct: 0 };
  const prev   = history[1] || latest;

  // Chart data sorted ascending by measurement date (dateOnly)
  const trends = [...history].reverse().map((h: any) => {
    // Use dateOnly (YYYY-MM-DD) if available, otherwise fall back to date
    const measureDate = h.dateOnly ? new Date(h.dateOnly) : new Date(h.date);
    return {
      date: measureDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      fullDate: measureDate.toLocaleDateString('vi-VN'),
      weight: h.weight,
      muscle: h.muscleMass,
      fat: h.bodyFat,
    };
  });

  const radarData = [
    { subject: "Weight", A: (latest.weight / 100) * 100 },
    { subject: "Muscle", A: (latest.muscleMass / 50) * 100 },
    { subject: "Fat",    A: (latest.bodyFat / 30) * 100 },
    { subject: "BMI",    A: (latest.bmi / 35) * 100 },
    { subject: "BMR",    A: ((latest.bmr || 1500) / 2500) * 100 },
  ];

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Tổng quan",     icon: Activity      },
    { key: "manual",   label: "Nhập thủ công", icon: ClipboardList },
    { key: "upload",   label: "Tải ảnh lên",   icon: Camera        },
    { key: "history",  label: "Lịch sử",       icon: History       },
    { key: "compare",  label: "So sánh",       icon: GitCompare    },
  ];

  /* ── Handlers ── */
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadStep("preview");
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      setUploadStep("processing");
      uploadMutation.mutate(selectedFile);
    }
  };

  const validateManual = () => {
    const e: Record<string, string> = {};
    const w = (document.getElementById("m-weight") as HTMLInputElement)?.value;
    if (!w || isNaN(Number(w))) e["weight"] = "Valid weight required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateManual()) return;
    
    const formData = new FormData(e.target as HTMLFormElement);
    const data: any = Object.fromEntries(formData.entries());
    
    const entry = {
      date: new Date(data.date).toISOString(),
      weight: parseFloat(data.weight),
      height: data.height ? parseFloat(data.height) : undefined,
      muscleMass: parseFloat(data.muscleMass),
      bodyFat: parseFloat(data.bodyFat),
      bodyFatPct: parseFloat(data.bodyFatPct),
      
      // Segmental
      rightArmMuscle: data.rightArmMuscle ? parseFloat(data.rightArmMuscle) : undefined,
      leftArmMuscle: data.leftArmMuscle ? parseFloat(data.leftArmMuscle) : undefined,
      trunkMuscle: data.trunkMuscle ? parseFloat(data.trunkMuscle) : undefined,
      rightLegMuscle: data.rightLegMuscle ? parseFloat(data.rightLegMuscle) : undefined,
      leftLegMuscle: data.leftLegMuscle ? parseFloat(data.leftLegMuscle) : undefined,
      
      status: "manual",
    };
    
    createMutation.mutate(entry);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const confirmExtraction = async () => {
    if (extractedData) {
      try {
        // Always include measurement date: reviewDate (user-confirmed) takes priority
        const dateToSave = reviewDate || new Date().toISOString().slice(0, 10);
        await createMutation.mutateAsync({
          ...extractedData,
          date: new Date(dateToSave + 'T00:00:00').toISOString(),
        });
        setUploadStep("done");
      } catch {
        // stays on review step; createMutation.isError shows the error inline
      }
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-400" />
            InBody Analysis
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Theo dõi thành phần cơ thể · Chọn phương thức nhập liệu bên dưới
          </p>
        </div>
        {/* Always-visible quick-add CTAs */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setTab("manual"); setManualStep("form"); }}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-200 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
          >
            <ClipboardList className="w-4 h-4 text-green-400" /> Nhập thủ công
          </button>
          <button
            onClick={() => { setTab("upload"); setUploadStep("drop"); }}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/25"
          >
            <Upload className="w-4 h-4" /> Tải ảnh InBody
          </button>
        </div>
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl overflow-x-auto w-full">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex-1 justify-center ${
              tab === t.key
                ? "bg-green-500 text-black shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════
          TAB: OVERVIEW
      ══════════════════════════════════════ */}
      {tab === "overview" && (
        <div className="space-y-4">

          {/* Two-method CTA banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => { setTab("manual"); setManualStep("form"); }}
              className="group flex items-center gap-4 bg-zinc-900 hover:bg-zinc-800/80 border-2 border-zinc-700/60 hover:border-green-500/40 rounded-xl p-4 text-left transition-all"
            >
              <div className="w-12 h-12 bg-violet-500/10 border border-violet-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-violet-500/20 transition-colors">
                <ClipboardList className="w-6 h-6 text-violet-400" />
              </div>
              <div>
                <div className="text-sm font-bold text-zinc-200">Nhập dữ liệu thủ công</div>
                <div className="text-xs text-zinc-500 mt-0.5">Nhập các giá trị từ phiếu InBody của bạn</div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-green-400 ml-auto transition-colors" />
            </button>

            <button
              onClick={() => { setTab("upload"); setUploadStep("drop"); }}
              className="group flex items-center gap-4 bg-zinc-900 hover:bg-zinc-800/80 border-2 border-zinc-700/60 hover:border-green-500/40 rounded-xl p-4 text-left transition-all"
            >
              <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-green-500/20 transition-colors">
                <Camera className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <div className="text-sm font-bold text-zinc-200">Tải ảnh InBody</div>
                <div className="text-xs text-zinc-500 mt-0.5">Chụp ảnh phiếu InBody — AI trích xuất dữ liệu</div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-green-400 ml-auto transition-colors" />
            </button>
          </div>

          {/* Latest snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Cân nặng",       value: `${latest.weight} kg`, prev: prev.weight, curr: latest.weight, unit: "kg", color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20"   },
              { label: "Cơ bắp",        value: `${latest.muscleMass} kg`, prev: prev.muscleMass, curr: latest.muscleMass, unit: "kg", color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/20"  },
              { label: "Khối lượng mỡ", value: `${latest.bodyFat} kg`,   prev: prev.bodyFat,    curr: latest.bodyFat,    unit: "kg", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
              { label: "% Mỡ cơ thể",   value: `${latest.bodyFatPct}%`,  prev: prev.bodyFatPct, curr: latest.bodyFatPct, unit: "%",  color: "text-rose-400",   bg: "bg-rose-500/10",   border: "border-rose-500/20"   },
            ].map(m => {
              const diff     = parseFloat((m.prev - m.curr).toFixed(1));
              const improved = m.label === "Cơ bắp" ? diff < 0 : diff > 0;
              return (
                <div key={m.label} className={`${m.bg} rounded-xl p-4 border ${m.border}`}>
                  <div className="text-xs text-zinc-500 mb-1">{m.label}</div>
                  <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                  <div className={`text-xs mt-1 flex items-center gap-1 ${improved ? "text-green-400" : "text-red-400"}`}>
                    {improved ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {Math.abs(diff)}{m.unit} so với lần trước
                  </div>
                </div>
              );
            })}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Xu hướng cân nặng & cơ bắp">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="weight" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.12} strokeWidth={2} name="Weight (kg)" />
                  <Area type="monotone" dataKey="muscle" stroke="#22c55e" fill="#22c55e" fillOpacity={0.12} strokeWidth={2} name="Muscle (kg)" />
                </AreaChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard title="Cân bằng cơ thể">
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#27272a" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: "#71717a" }} />
                  <Radar dataKey="A" stroke="#22c55e" fill="#22c55e" fillOpacity={0.12} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          {/* Segmental */}
          <SectionCard title="Phân tích cơ bắp theo vùng">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[450px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-600 border-b border-zinc-800/60 uppercase tracking-wider">
                    <th className="pb-2">Vùng cơ thể</th>
                    <th className="pb-2">Cơ (kg)</th>
                    <th className="pb-2">Bình thường</th>
                    <th className="pb-2">Cân bằng</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Tay phải",  value: latest.rightArmMuscle, norm: 3.2 },
                    { label: "Tay trái",  value: latest.leftArmMuscle,  norm: 3.2 },
                    { label: "Thân mình", value: latest.trunkMuscle,    norm: 24.0 },
                    { label: "Chân phải", value: latest.rightLegMuscle, norm: 9.5 },
                    { label: "Chân trái", value: latest.leftLegMuscle,  norm: 9.5 },
                  ].map((s: { label: string; value: number | undefined; norm: number; }) => {
                    const val = s.value || 0;
                    const norm = s.norm;
                    return (
                      <tr key={s.label} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                        <td className="py-2.5 font-semibold text-zinc-200">{s.label}</td>
                        <td className="py-2.5 text-green-400 font-semibold">{val}</td>
                        <td className="py-2.5 text-zinc-500">{norm}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full max-w-[80px]">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, (val / norm) * 80)}%` }} />
                            </div>
                            <span className={`text-xs font-bold ${val >= norm ? "text-green-400" : "text-red-400"}`}>
                              {val >= norm ? "+" : ""}{((val - norm) / norm * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Recent history */}
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Bản ghi gần đây</h4>
            <button onClick={() => setTab("history")} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors">
              Xem tất cả <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {history.slice(0, 3).map((r: any, i: number) => {
              const cfg = statusConfig[r.status];
              return (
                <div key={r.id} className={`flex items-center gap-4 p-3 rounded-xl border ${i === 0 ? "bg-green-500/5 border-green-500/15" : "bg-zinc-900 border-zinc-800/60"}`}>
                  <div className="text-sm font-semibold text-zinc-200 w-28 flex-shrink-0">
                    {formatMeasurementDate(r)}
                    {i === 0 && <span className="ml-1 text-xs bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded-full border border-green-500/20">Mới nhất</span>}
                  </div>
                  <div className="flex gap-4 text-xs text-zinc-500">
                    <span className="text-blue-400 font-semibold">{r.weight}kg</span>
                    <span className="text-green-400 font-semibold">{r.muscleMass}kg cơ bắp</span>
                    <span className="text-orange-400">{r.bodyFatPct}% BF</span>
                  </div>
                  <span className={`ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.color}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          TAB: MANUAL ENTRY
      ══════════════════════════════════════ */}
      {tab === "manual" && (
        <div className="max-w-2xl mx-auto space-y-4">

          {manualStep === "done" ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center">
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/15">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-zinc-100 font-bold mb-1">Đã lưu dữ liệu!</h3>
              <p className="text-zinc-500 text-sm mb-5">Dữ liệu thành phần cơ thể của bạn đã được ghi lại thành công.</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => { setManualStep("form"); }} className="px-5 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-lg hover:bg-zinc-700 transition-colors">
                  Thêm bản ghi
                </button>
                <button onClick={() => setTab("history")} className="px-5 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                  Xem lịch sử
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 bg-violet-500/8 border border-violet-500/20 rounded-xl px-4 py-3">
                <ClipboardList className="w-4 h-4 text-violet-400 flex-shrink-0" />
                <p className="text-sm text-violet-300">Nhập trực tiếp các giá trị InBody của bạn. Các trường có dấu * là bắt buộc.</p>
              </div>

              {/* Actions */}
              <form onSubmit={handleManualSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SectionCard title="📅 Thông tin kiểm tra">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Ngày kiểm tra *</label>
                      <input name="date" type="date" className={inp} defaultValue={new Date().toISOString().split('T')[0]} required />
                    </div>
                  </SectionCard>
                  
                  <SectionCard title="⚖️ Số đo cơ bản">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Cân nặng (kg) *</label>
                        <input name="weight" id="m-weight" type="number" step="0.1" placeholder="75.0" className={inp} required />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Chiều cao (cm)</label>
                        <input name="height" id="m-height" type="number" step="0.1" placeholder="175" className={inp} />
                      </div>
                    </div>
                  </SectionCard>
                </div>

                <SectionCard title="💪 Thành phần cơ thể">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Cơ bắp (kg)</label>
                      <input name="muscleMass" type="number" step="0.1" placeholder="35.0" className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Mỡ cơ thể (kg)</label>
                      <input name="bodyFat" type="number" step="0.1" placeholder="12.0" className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">% Mỡ cơ thể</label>
                      <input name="bodyFatPct" type="number" step="0.1" placeholder="15.0" className={inp} />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="🦵 Cơ theo vùng (kg)">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Tay P</label>
                      <input name="rightArmMuscle" type="number" step="0.1" placeholder="3.2" className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Tay T</label>
                      <input name="leftArmMuscle" type="number" step="0.1" placeholder="3.2" className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Thân</label>
                      <input name="trunkMuscle" type="number" step="0.1" placeholder="24.0" className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Chân P</label>
                      <input name="rightLegMuscle" type="number" step="0.1" placeholder="9.5" className={inp} />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Chân T</label>
                      <input name="leftLegMuscle" type="number" step="0.1" placeholder="9.5" className={inp} />
                    </div>
                  </div>
                </SectionCard>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setTab("overview")} className="px-4 py-2.5 border border-zinc-700/60 text-zinc-400 text-sm font-semibold rounded-xl hover:bg-zinc-800 transition-colors">
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
                  >
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {createMutation.isPending ? "Đang lưu..." : "Lưu bản ghi"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════
          TAB: UPLOAD IMAGE
      ══════════════════════════════════════ */}
      {tab === "upload" && (
        <div className="max-w-xl mx-auto space-y-4">

          {/* Stepper */}
          <div className="flex items-center gap-2">
            {[
              { label: "Tải lên",   key: "drop"       },
              { label: "Xem trước", key: "preview"    },
              { label: "Xử lý",     key: "processing" },
              { label: "Xem lại",   key: "review"     },
              { label: "Hoàn tất",  key: "done"       },
            ].map((s: { label: string; key: string; }, i: number) => {
              const stepKeys  = ["drop", "preview", "processing", "review", "done", "failed"];
              const currIdx   = stepKeys.indexOf(uploadStep);
              const thisIdx   = stepKeys.indexOf(s.key);
              const done      = currIdx > thisIdx;
              const active    = currIdx === thisIdx;
              return (
                <div key={s.key} className="flex items-center gap-1.5 flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
                    done ? "bg-green-500 text-black" : active ? "bg-green-500 text-black shadow-md shadow-green-500/30" : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                  }`}>
                    {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-xs hidden sm:block font-medium ${active ? "text-green-400" : "text-zinc-600"}`}>{s.label}</span>
                  {i < 4 && <div className={`flex-1 h-0.5 rounded-full transition-all ${done ? "bg-green-500" : "bg-zinc-800"}`} />}
                </div>
              );
            })}
          </div>

          {/* Step: Drop */}
          {uploadStep === "drop" && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { 
                e.preventDefault(); 
                setDragOver(false); 
                if (e.dataTransfer.files[0]) {
                  setSelectedFile(e.dataTransfer.files[0]);
                  setUploadStep("preview");
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                dragOver ? "border-green-500 bg-green-500/8" : "border-zinc-700 hover:border-green-500/50 hover:bg-zinc-800/40"
              }`}
            >
              <input type="file" ref={fileInputRef} onChange={onFileSelect} className="hidden" accept="image/*" />
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Camera className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">Tải ảnh phiếu InBody</h3>
              <p className="text-zinc-500 text-sm mb-4">Kéo thả hoặc bấm để chọn ảnh phiếu InBody</p>
              <div className="flex items-center gap-2 justify-center">
                <span className="text-xs text-zinc-600 bg-zinc-800 border border-zinc-700/50 px-2 py-1 rounded-full">JPG</span>
                <span className="text-xs text-zinc-600 bg-zinc-800 border border-zinc-700/50 px-2 py-1 rounded-full">PNG</span>
                <span className="text-xs text-zinc-600">· Max 10MB</span>
              </div>
            </div>
          )}

          {/* Step: Preview */}
          {uploadStep === "preview" && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60 bg-zinc-800/40">
                <FileImage className="w-4 h-4 text-zinc-400" />
                <span className="text-sm text-zinc-300 font-semibold">{selectedFile?.name}</span>
                <span className="ml-auto text-xs text-zinc-600">{(selectedFile!.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
              {/* Image preview */}
              <div className="p-4">
                <div className="w-full h-48 bg-zinc-800/60 border border-zinc-700/40 rounded-lg flex items-center justify-center relative overflow-hidden">
                  <img src={URL.createObjectURL(selectedFile!)} className="h-full object-contain" alt="Preview" />
                </div>
              </div>
              <div className="flex gap-2 p-4 border-t border-zinc-800/60">
                <button onClick={() => { setSelectedFile(null); setUploadStep("drop"); }} className="flex-1 py-2 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800/60">
                  Chọn ảnh khác
                </button>
                <button
                  onClick={handleUpload}
                  className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20"
                >
                  Trích xuất bằng AI
                </button>
              </div>
            </div>
          )}

          {/* Step: Processing */}
          {uploadStep === "processing" && (
            <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-10 text-center">
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <RefreshCw className="w-8 h-8 text-green-400 animate-spin" />
              </div>
              <div className="text-zinc-200 font-bold mb-1">Đang trích xuất dữ liệu bằng AI…</div>
              <p className="text-zinc-500 text-sm">Đang phân tích ảnh phiếu InBody của bạn</p>
              <div className="flex gap-1 justify-center mt-5">
                {[0, 1, 2].map((i: number) => (
                  <div key={i} className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <div className="mt-4 space-y-1.5 text-left max-w-xs mx-auto">
                {["Nhận dạng định dạng InBody…", "Đọc nhãn thông số…", "Trích xuất giá trị số…"].map((t: string, i: number) => (
                  <div key={t} className="flex items-center gap-2 text-xs text-zinc-600">
                    <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step: Review (extraction review) */}
          {uploadStep === "review" && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/8 border-b border-amber-500/20">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-amber-300 font-semibold">Kiểm tra dữ liệu trích xuất — chỉnh sửa nếu cần trước khi lưu</span>
              </div>
              <div className="p-4 space-y-4">
                {/* Measurement Date — critical field, shown first */}
                <div className={`rounded-lg border p-3 ${
                  extractedData?.date
                    ? 'bg-green-500/5 border-green-500/20'
                    : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">📅 Ngày đo InBody</span>
                    {extractedData?.date
                      ? <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">Đọc được từ ảnh</span>
                      : <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">Không đọc được — nhập thủ công</span>
                    }
                  </div>
                  <input
                    type="date"
                    value={reviewDate}
                    onChange={(e) => setReviewDate(e.target.value)}
                    className={inp}
                    required
                  />
                  <p className="text-xs text-zinc-600 mt-1">
                    Đây là ngày đo trên phiếu InBody, không phải ngày tải ảnh. Upload 2 ảnh cùng ngày đo → chỉ lưu 1 bản ghi, dữ liệu mới nhất.
                  </p>
                </div>

                {/* Basic Metrics */}
                <div>
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Thông số cơ bản</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Cân nặng (kg)",  field: "weight",     value: extractedData?.weight },
                      { label: "Chiều cao (cm)", field: "height",     value: extractedData?.height },
                      { label: "Cơ bắp (kg)",    field: "muscleMass", value: extractedData?.muscleMass },
                      { label: "Mỡ cơ thể (kg)", field: "bodyFat",    value: extractedData?.bodyFat },
                      { label: "% Mỡ cơ thể",    field: "bodyFatPct", value: extractedData?.bodyFatPct },
                      { label: "BMI",             field: "bmi",        value: extractedData?.bmi },
                    ].map((f: { label: string; field: string; value: number | undefined }) => (
                      <div key={f.field}>
                        <label className="text-xs text-zinc-500 mb-1 block">{f.label}</label>
                        <input type="number" step="0.1" defaultValue={f.value}
                          onChange={(e) => setExtractedData({ ...extractedData, [f.field]: parseFloat(e.target.value) })}
                          className={inp} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Segmental Lean Analysis */}
                <div>
                  <h4 className="text-xs font-bold text-green-400/80 uppercase tracking-wider mb-2">Cơ theo vùng (kg)</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Tay phải",  field: "rightArmMuscle", value: extractedData?.rightArmMuscle },
                      { label: "Tay trái",  field: "leftArmMuscle",  value: extractedData?.leftArmMuscle },
                      { label: "Chân phải", field: "rightLegMuscle", value: extractedData?.rightLegMuscle },
                      { label: "Chân trái", field: "leftLegMuscle",  value: extractedData?.leftLegMuscle },
                      { label: "Thân mình", field: "trunkMuscle",    value: extractedData?.trunkMuscle },
                    ].map((f: { label: string; field: string; value: number | undefined }) => (
                      <div key={f.field}>
                        <label className="text-xs text-zinc-500 mb-1 block">{f.label}</label>
                        <input type="number" step="0.01" defaultValue={f.value}
                          onChange={(e) => setExtractedData({ ...extractedData, [f.field]: parseFloat(e.target.value) })}
                          className={inp} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Segmental Fat Analysis */}
                <div>
                  <h4 className="text-xs font-bold text-amber-400/80 uppercase tracking-wider mb-2">Mỡ theo vùng (kg)</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Tay phải",  field: "rightArmFat", value: extractedData?.rightArmFat },
                      { label: "Tay trái",  field: "leftArmFat",  value: extractedData?.leftArmFat },
                      { label: "Chân phải", field: "rightLegFat", value: extractedData?.rightLegFat },
                      { label: "Chân trái", field: "leftLegFat",  value: extractedData?.leftLegFat },
                      { label: "Thân mình", field: "trunkFat",    value: extractedData?.trunkFat },
                    ].map((f: { label: string; field: string; value: number | undefined }) => (
                      <div key={f.field}>
                        <label className="text-xs text-zinc-500 mb-1 block">{f.label}</label>
                        <input type="number" step="0.01" defaultValue={f.value}
                          onChange={(e) => setExtractedData({ ...extractedData, [f.field]: parseFloat(e.target.value) })}
                          className={inp} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 p-4 border-t border-zinc-800/60">
                <button onClick={() => setUploadStep("drop")} className="flex-1 py-2 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800/60 transition-colors">
                  Chụp lại
                </button>
                <button onClick={confirmExtraction} className="flex-1 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                  Xác nhận & Lưu
                </button>
              </div>
            </div>
          )}

          {/* Step: Failed */}
          {uploadStep === "failed" && (
            <div className="bg-zinc-900 rounded-xl border border-red-500/20 p-8 text-center">
              <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">Trích xuất thất bại</h3>
              <p className="text-zinc-500 text-sm mb-5">AI không thể đọc đủ dữ liệu từ ảnh này. Hãy thử ảnh rõ hơn hoặc nhập thủ công.</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setUploadStep("drop")} className="px-5 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-lg hover:bg-zinc-700 transition-colors">
                  Thử lại
                </button>
                <button onClick={() => { setTab("manual"); setManualStep("form"); }} className="px-5 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                  Nhập thủ công
                </button>
              </div>
            </div>
          )}

          {/* Step: Done */}
          {uploadStep === "done" && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center">
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/15">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">Đã lưu InBody!</h3>
              <p className="text-zinc-500 text-sm mb-5">Dữ liệu thành phần cơ thể đã được trích xuất và xác nhận thành công.</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setUploadStep("drop")} className="px-5 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-lg hover:bg-zinc-700 transition-colors">
                  Tải ảnh khác
                </button>
                <button onClick={() => setTab("history")} className="px-5 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                  Xem lịch sử
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════
          TAB: HISTORY
      ══════════════════════════════════════ */}
      {tab === "history" && (
        <div className="space-y-4">
          {/* Status legend */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(statusConfig).map(([k, cfg]: [string, { label: string; color: string; dot: string; }]) => (
              <span key={k} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border ${cfg.color}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            ))}
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-200">Lịch sử InBody ({history.length} bản ghi)</h4>
              <button onClick={() => setTab("upload")} className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Thêm mới
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="text-left text-xs text-zinc-600 border-b border-zinc-800/60 bg-zinc-800/30 uppercase tracking-wider">
                    <th className="px-4 py-2.5">Ngày</th>
                    <th className="px-4 py-2.5">Cân nặng (kg)</th>
                    <th className="px-4 py-2.5">Cơ bắp (kg)</th>
                    <th className="px-4 py-2.5">Mỡ (kg)</th>
                    <th className="px-4 py-2.5">% Mỡ</th>
                    <th className="px-4 py-2.5">Phương thức</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.length > 0 ? history.map((r: any, i: number) => {
                    const cfg = statusConfig[r.status] || statusConfig.manual;
                    return (
                      <tr key={r.id} className={`border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors ${i === 0 ? "bg-green-500/5" : ""}`}>
                        <td className="px-4 py-3 text-sm font-semibold text-zinc-200">
                          {formatMeasurementDate(r)}
                          {i === 0 && <span className="ml-1.5 text-xs bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded-full border border-green-500/20">Mới nhất</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-blue-400 font-semibold">{r.weight}</td>
                        <td className="px-4 py-3 text-sm text-green-400 font-semibold">{r.muscleMass}</td>
                        <td className="px-4 py-3 text-sm text-orange-400">{r.bodyFat}</td>
                        <td className="px-4 py-3 text-sm text-rose-400 font-semibold">{r.bodyFatPct}%</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.color}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button className="text-zinc-600 hover:text-green-400 transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-zinc-500">Chưa có bản ghi nào.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trend chart */}
          <SectionCard title="Xu hướng mỡ cơ thể">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="fat" stroke="#f97316" fill="#f97316" fillOpacity={0.12} strokeWidth={2} name="Body Fat (kg)" />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
      )}

      {/* ══════════════════════════════════════
          TAB: COMPARE
      ══════════════════════════════════════ */}
      {tab === "compare" && (
        <div className="space-y-4">
          {history.length < 2 ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center">
              <div className="text-zinc-400 font-semibold mb-1">Chưa đủ dữ liệu</div>
              <p className="text-zinc-600 text-sm">Bạn cần ít nhất 2 bản ghi InBody để so sánh.</p>
            </div>
          ) : (<>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Bản ghi A</label>
              <select value={compareA} onChange={e => setCompareA(Number(e.target.value))} className={inp}>
                {history.map((h: any, i: number) => <option key={h.id} value={i}>{formatMeasurementDate(h)}</option>)}
              </select>
            </div>
            <span className="text-zinc-600 text-sm self-center hidden sm:block font-bold">vs</span>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Bản ghi B</label>
              <select value={compareB} onChange={e => setCompareB(Number(e.target.value))} className={inp}>
                {history.map((h: any, i: number) => <option key={h.id} value={i}>{formatMeasurementDate(h)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { key: "weight",     label: "Cân nặng (kg)" },
              { key: "muscleMass", label: "Cơ bắp (kg)" },
              { key: "bodyFat",    label: "Mỡ cơ thể (kg)" },
              { key: "bodyFatPct", label: "% Mỡ cơ thể" },
            ] as const).map(({ key, label }) => {
              const aVal   = (history[compareA]?.[key] as number) || 0;
              const bVal   = (history[compareB]?.[key] as number) || 0;
              const diff   = aVal - bVal;
              const isGood = key === "muscleMass" ? diff > 0 : diff < 0;
              const isPct  = key === "bodyFatPct";
              return (
                <div key={key} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
                  <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wider">{label}</div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-lg font-bold text-zinc-100">{aVal}{isPct ? "%" : ""}</div>
                      <div className="text-xs text-zinc-600">{formatMeasurementDate(history[compareA])}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${isGood ? "text-green-400" : "text-red-400"}`}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(1)}{isPct ? "%" : ""}
                      </div>
                      <div className="text-xs text-zinc-600">{formatMeasurementDate(history[compareB])}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <SectionCard title="Biểu đồ so sánh">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[
                { metric: "Weight", A: history[compareA]?.weight || 0, B: history[compareB]?.weight || 0 },
                { metric: "Muscle", A: history[compareA]?.muscleMass || 0, B: history[compareB]?.muscleMass || 0 },
                { metric: "Fat",    A: history[compareA]?.bodyFat || 0,    B: history[compareB]?.bodyFat || 0    },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="metric" tick={{ fontSize: 11, fill: "#71717a" }} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="A" fill="#22c55e" radius={[4, 4, 0, 0]} name={formatMeasurementDate(history[compareA])} />
                <Bar dataKey="B" fill="#3f3f46" radius={[4, 4, 0, 0]} name={formatMeasurementDate(history[compareB])} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
          </>)}
        </div>
      )}
    </div>
  );
}
