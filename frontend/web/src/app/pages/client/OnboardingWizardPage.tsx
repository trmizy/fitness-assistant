import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dumbbell,
  Target,
  CalendarDays,
  ShieldAlert,
  Ruler,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { profileService } from "../../services/api";
import { toast } from "sonner";

/**
 * First-run onboarding wizard — collects everything the Decision Engine and
 * plan-generation flows need but that a brand-new profile leaves null:
 * training level, goal, days/week, equipment, injury/pain limitations,
 * sport/competition status, preferred split, and a body-metric baseline.
 * Writes through the SAME PUT /profile/me endpoint ProfilePage uses (no
 * parallel write path), setting hasCompletedOnboarding=true only on the
 * final step — see RequireOnboarding for the redirect that sends users here.
 */

const inp =
  "w-full px-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 placeholder-zinc-600 transition-all";
const lbl = "text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold";

const steps = [
  { key: "level", label: "Trình độ & Mục tiêu", icon: Target },
  { key: "schedule", label: "Lịch tập", icon: CalendarDays },
  { key: "equipment", label: "Thiết bị", icon: Dumbbell },
  { key: "safety", label: "Sức khỏe & Thi đấu", icon: ShieldAlert },
  { key: "body", label: "Chỉ số cơ thể", icon: Ruler },
  { key: "review", label: "Xem lại", icon: CheckCircle },
];

const experienceLevels = [
  { key: "BEGINNER", label: "Mới bắt đầu", desc: "Dưới 6 tháng tập luyện có hệ thống" },
  { key: "INTERMEDIATE", label: "Đã biết tập", desc: "6 tháng - 2 năm, đã quen kỹ thuật cơ bản" },
  { key: "ADVANCED", label: "Nâng cao", desc: "2+ năm, tập luyện có chu kỳ" },
];

const goalOptions = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ", emoji: "🔥" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ", emoji: "💪" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng", emoji: "⚖️" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao", emoji: "🏆" },
];

const weekdayOptions = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

const equipmentOptions = ["barbell", "dumbbells", "machines", "cables", "bodyweight", "resistance_bands", "kettlebell"];
const equipmentLabels: Record<string, string> = {
  barbell: "Thanh đòn (Barbell)",
  dumbbells: "Tạ đơn (Dumbbells)",
  machines: "Máy tập (Machines)",
  cables: "Ròng rọc (Cables)",
  bodyweight: "Trọng lượng cơ thể",
  resistance_bands: "Dây kháng lực",
  kettlebell: "Kettlebell",
};

const splitOptions = ["Full Body", "Upper/Lower", "Push/Pull/Legs", "Bro Split", "Chưa xác định"];

export function OnboardingWizardPage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState(0);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((r) => r.profile),
    enabled: !!user?.id,
  });

  const [experienceLevel, setExperienceLevel] = useState("");
  const [goal, setGoal] = useState("");
  const [trainingDays, setTrainingDays] = useState<number[]>([]);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState("60");
  const [preferredSplit, setPreferredSplit] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [injuriesText, setInjuriesText] = useState("");
  const [competesInSport, setCompetesInSport] = useState(false);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");

  // Pre-fill from any partial profile already saved (e.g. user filled some
  // of ProfilePage before the wizard existed, or came back after skipping).
  useEffect(() => {
    const p = profileQuery.data;
    if (!p) return;
    if (p.experienceLevel) setExperienceLevel(p.experienceLevel);
    if (p.goal) setGoal(p.goal);
    if (Array.isArray(p.preferredTrainingDays)) setTrainingDays(p.preferredTrainingDays);
    if (p.sessionDurationMinutes) setSessionDurationMinutes(String(p.sessionDurationMinutes));
    if (p.preferredSplit) setPreferredSplit(p.preferredSplit);
    if (Array.isArray(p.availableEquipment)) setEquipment(p.availableEquipment);
    if (Array.isArray(p.injuries)) setInjuriesText(p.injuries.join(", "));
    if (typeof p.competesInSport === "boolean") setCompetesInSport(p.competesInSport);
    if (p.age) setAge(String(p.age));
    if (p.gender) setGender(p.gender);
    if (p.heightCm) setHeightCm(String(p.heightCm));
    if (p.currentWeight) setCurrentWeight(String(p.currentWeight));
    if (p.targetWeight) setTargetWeight(String(p.targetWeight));
  }, [profileQuery.data]);

  function buildPayload() {
    return {
      experienceLevel: experienceLevel || undefined,
      goal: goal || undefined,
      preferredTrainingDays: trainingDays,
      sessionDurationMinutes: sessionDurationMinutes ? parseInt(sessionDurationMinutes, 10) : undefined,
      preferredSplit: preferredSplit && preferredSplit !== "Chưa xác định" ? preferredSplit : undefined,
      availableEquipment: equipment,
      injuries: injuriesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      competesInSport,
      age: age ? parseInt(age, 10) : undefined,
      gender: gender || undefined,
      heightCm: heightCm ? parseFloat(heightCm) : undefined,
      currentWeight: currentWeight ? parseFloat(currentWeight) : undefined,
      targetWeight: targetWeight ? parseFloat(targetWeight) : undefined,
      // Always true on any submission from this page — including "skip",
      // which saves whatever was filled in so far (possibly nothing) and
      // marks onboarding as seen. Otherwise RequireOnboarding would bounce
      // the user straight back here on the very next navigation, turning
      // "skip" into a dead end instead of a real escape hatch.
      hasCompletedOnboarding: true,
    };
  }

  const submitMutation = useMutation({
    mutationFn: (finishedAllSteps: boolean) =>
      profileService.updateProfile(buildPayload()).then((r) => ({ profile: r.profile, finishedAllSteps })),
    onSuccess: ({ profile, finishedAllSteps }) => {
      // Write the fresh profile into the cache SYNCHRONOUSLY (not
      // invalidateQueries, which only schedules a background refetch) before
      // navigating — RequireOnboarding reads this same query key immediately
      // on mount at the destination route, and would otherwise still see the
      // pre-submit stale value (hasCompletedOnboarding: false) and bounce the
      // user straight back here.
      queryClient.setQueryData(["profile", user?.id], profile);
      toast.success(finishedAllSteps ? "Đã lưu hồ sơ tập luyện" : "Đã bỏ qua — bạn có thể cập nhật lại trong Hồ sơ");
      navigate("/client/dashboard");
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể lưu hồ sơ");
    },
  });

  const isLastStep = currentStep === steps.length - 1;
  const canGoNext = () => {
    if (currentStep === 0) return !!experienceLevel && !!goal;
    return true;
  };

  const toggleDay = (d: number) => {
    setTrainingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };
  const toggleEquipment = (e: string) => {
    setEquipment((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-green-400" /> Thiết lập hồ sơ tập luyện
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Vài câu hỏi nhanh để cá nhân hoá lịch tập và các đề xuất AI cho bạn.
        </p>
      </div>

      {/* Stepper */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-start gap-1 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => i < currentStep && setCurrentStep(i)}
                className="flex flex-col items-center gap-1.5 flex-1 min-w-[60px] group transition-all"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all flex-shrink-0 ${
                    done
                      ? "bg-green-500 text-black"
                      : active
                        ? "bg-green-500 text-black shadow-lg shadow-green-500/30"
                        : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                  }`}
                >
                  {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
                </div>
                <span
                  className={`text-[10px] text-center leading-tight hidden sm:block font-medium ${active ? "text-green-400" : done ? "text-zinc-400" : "text-zinc-600"}`}
                >
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
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
          />
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden flex flex-col min-h-[360px]">
        <div className="p-6 flex-1 space-y-5">
          {currentStep === 0 && (
            <>
              <div>
                <label className={lbl}>Trình độ tập luyện *</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {experienceLevels.map((lvl) => (
                    <button
                      key={lvl.key}
                      type="button"
                      onClick={() => setExperienceLevel(lvl.key)}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${
                        experienceLevel === lvl.key
                          ? "border-green-500 bg-green-500/10"
                          : "border-zinc-700/60 hover:border-zinc-600"
                      }`}
                    >
                      <div className="text-sm font-semibold text-zinc-200">{lvl.label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{lvl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Mục tiêu chính *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {goalOptions.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setGoal(g.key)}
                      className={`flex flex-col items-center gap-1 px-3 py-3 border-2 rounded-xl text-sm transition-all ${
                        goal === g.key
                          ? "border-green-500 bg-green-500/10 text-green-400 font-semibold"
                          : "border-zinc-700/60 text-zinc-500 hover:border-zinc-600"
                      }`}
                    >
                      <span className="text-lg">{g.emoji}</span>
                      <span className="text-xs">{g.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {currentStep === 1 && (
            <>
              <div>
                <label className={lbl}>Ngày tập trong tuần</label>
                <div className="flex flex-wrap gap-2">
                  {weekdayOptions.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={`w-12 h-12 rounded-xl text-sm font-semibold border-2 transition-all ${
                        trainingDays.includes(d.value)
                          ? "border-green-500 bg-green-500/10 text-green-400"
                          : "border-zinc-700/60 text-zinc-500 hover:border-zinc-600"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 mt-1.5">Đã chọn {trainingDays.length} ngày/tuần</p>
              </div>
              <div>
                <label className={lbl}>Thời lượng mỗi buổi (phút)</label>
                <input
                  type="number"
                  min={15}
                  max={180}
                  value={sessionDurationMinutes}
                  onChange={(e) => setSessionDurationMinutes(e.target.value)}
                  className={inp}
                />
              </div>
              <div>
                <label className={lbl}>Kiểu chia lịch ưa thích (nếu có)</label>
                <select value={preferredSplit} onChange={(e) => setPreferredSplit(e.target.value)} className={inp}>
                  <option value="">Chưa có ý kiến</option>
                  {splitOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {currentStep === 2 && (
            <div>
              <label className={lbl}>Thiết bị bạn có thể sử dụng</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {equipmentOptions.map((eq) => (
                  <label
                    key={eq}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm cursor-pointer transition-all ${
                      equipment.includes(eq) ? "border-green-500 bg-green-500/10 text-green-400" : "border-zinc-700/60 text-zinc-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={equipment.includes(eq)}
                      onChange={() => toggleEquipment(eq)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-green-500"
                    />
                    {equipmentLabels[eq]}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-zinc-600 mt-2">
                Không chọn gì nghĩa là phòng gym đầy đủ thiết bị — AI sẽ ưu tiên bài barbell/máy tập.
              </p>
            </div>
          )}

          {currentStep === 3 && (
            <>
              <div>
                <label className={lbl}>Chấn thương hoặc hạn chế cần lưu ý</label>
                <textarea
                  rows={3}
                  placeholder="Ví dụ: đau vai trái, đau lưng dưới — cách nhau bằng dấu phẩy"
                  value={injuriesText}
                  onChange={(e) => setInjuriesText(e.target.value)}
                  className={`${inp} resize-none`}
                />
                <p className="text-[11px] text-zinc-600 mt-1">Để trống nếu không có chấn thương nào.</p>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={competesInSport}
                    onChange={(e) => setCompetesInSport(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-green-500"
                  />
                  Tôi đang thi đấu thể hình/thể thao chuyên nghiệp
                </label>
                <p className="text-[11px] text-zinc-600 mt-1">
                  Bật mục này để hệ thống áp dụng ngưỡng kiểm tra dữ liệu chặt chẽ hơn, không đưa lời khuyên đơn giản hoá.
                </p>
              </div>
            </>
          )}

          {currentStep === 4 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Tuổi</label>
                <input type="number" value={age} onChange={(e) => setAge(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Giới tính</label>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={inp}>
                  <option value="">Chưa thiết lập</option>
                  <option value="MALE">Nam</option>
                  <option value="FEMALE">Nữ</option>
                  <option value="OTHER">Khác</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Chiều cao (cm)</label>
                <input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Cân nặng hiện tại (kg)</label>
                <input type="number" value={currentWeight} onChange={(e) => setCurrentWeight(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Cân nặng mục tiêu (kg, nếu có)</label>
                <input type="number" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} className={inp} />
              </div>
            </div>
          )}

          {isLastStep && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">Kiểm tra lại thông tin trước khi hoàn tất:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <ReviewRow label="Trình độ" value={experienceLevels.find((l) => l.key === experienceLevel)?.label} onEdit={() => setCurrentStep(0)} />
                <ReviewRow label="Mục tiêu" value={goalOptions.find((g) => g.key === goal)?.label} onEdit={() => setCurrentStep(0)} />
                <ReviewRow label="Ngày tập/tuần" value={`${trainingDays.length} ngày`} onEdit={() => setCurrentStep(1)} />
                <ReviewRow label="Kiểu chia lịch" value={preferredSplit || "Chưa có ý kiến"} onEdit={() => setCurrentStep(1)} />
                <ReviewRow label="Thiết bị" value={equipment.length ? equipment.map((e) => equipmentLabels[e]).join(", ") : "Phòng gym đầy đủ"} onEdit={() => setCurrentStep(2)} />
                <ReviewRow label="Chấn thương" value={injuriesText || "Không có"} onEdit={() => setCurrentStep(3)} />
                <ReviewRow label="Thi đấu chuyên nghiệp" value={competesInSport ? "Có" : "Không"} onEdit={() => setCurrentStep(3)} />
                <ReviewRow label="Chỉ số cơ thể" value={[age && `${age} tuổi`, heightCm && `${heightCm}cm`, currentWeight && `${currentWeight}kg`].filter(Boolean).join(", ") || "Chưa nhập"} onEdit={() => setCurrentStep(4)} />
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="border-t border-zinc-800/60 p-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-zinc-400 border border-zinc-700/60 disabled:opacity-40 hover:bg-zinc-800 transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Quay lại
          </button>
          <button
            type="button"
            onClick={() => submitMutation.mutate(false)}
            disabled={submitMutation.isPending}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
          >
            Bỏ qua, thiết lập sau
          </button>
          {isLastStep ? (
            <button
              type="button"
              onClick={() => submitMutation.mutate(true)}
              disabled={submitMutation.isPending}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/25 disabled:opacity-60 transition-all"
            >
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Hoàn tất
            </button>
          ) : (
            <button
              type="button"
              onClick={() => canGoNext() && setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
              disabled={!canGoNext()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/25 disabled:opacity-40 transition-all"
            >
              Tiếp tục <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value?: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-zinc-800/40 rounded-lg px-3 py-2">
      <div>
        <div className="text-[11px] text-zinc-600 uppercase tracking-wider">{label}</div>
        <div className="text-zinc-200">{value || "—"}</div>
      </div>
      <button type="button" onClick={onEdit} className="text-[11px] text-green-400 hover:text-green-300 flex-shrink-0">
        Sửa
      </button>
    </div>
  );
}
