import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  User,
  Edit3,
  Check,
  Zap,
  ChevronRight,
  Award,
  Loader2,
  Camera,
  Dumbbell,
  TrendingDown,
  TrendingUp,
  Target,
  Upload,
  Download,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { profileService } from "../../services/api";
import { toast } from "sonner";

const goals = [
  { key: "lose_fat", label: "Giảm mỡ", emoji: "🔥" },
  { key: "gain_muscle", label: "Tăng cơ", emoji: "💪" },
  { key: "gain_weight", label: "Tăng cân", emoji: "📈" },
  { key: "maintain", label: "Duy trì vóc dáng", emoji: "⚖️" },
  { key: "improve_health", label: "Cải thiện sức khỏe", emoji: "❤️" },
];

const activityLevels = [
  "Ít vận động",
  "Vận động nhẹ",
  "Vận động vừa",
  "Năng động",
  "Cực kỳ năng động",
];
const dietPrefs = [
  "Không yêu cầu",
  "Nhiều protein",
  "Ăn chay (có trứng/sữa)",
  "Thuần chay",
  "Keto",
  "Ít tinh bột",
];

// Explicit 4th "chưa xác định" option (maps to no value sent, i.e. UNKNOWN
// on the backend) — never silently defaulted to BEGINNER/INTERMEDIATE.
// This is what the training-cycle AI flow gates advanced-technique
// suggestions on (see ai-service's cycle-analysis.service.ts).
const experienceLevels: Array<{ key: string; label: string }> = [
  { key: "", label: "Chưa xác định" },
  { key: "BEGINNER", label: "Người mới (Beginner)" },
  { key: "INTERMEDIATE", label: "Trung cấp (Intermediate)" },
  { key: "ADVANCED", label: "Nâng cao (Advanced)" },
];

const inputClass =
  "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 transition-all";
const selectClass =
  "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 bg-zinc-800/60 text-zinc-200";

export function ProfilePage() {
  const { user, isPT, setActiveView, updateUser } = useApp();
  const navigate = useNavigate();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: profileData, isLoading } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.profile;
    },
    enabled: !!user?.id,
  });

  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState("lose_fat");
  const [activity, setActivity] = useState("Vận động vừa");
  const [diet, setDiet] = useState("Nhiều protein");

  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [competesInSport, setCompetesInSport] = useState(false);
  const [injuriesText, setInjuriesText] = useState("");

  // Sync isPT from profile API into context/localStorage when user is approved
  useEffect(() => {
    if (profileData?.isPT && !isPT) {
      updateUser({ isPT: true, role: "PT" });
    }
  }, [profileData?.isPT]);

  useEffect(() => {
    if (profileData) {
      if (profileData.goal) {
        const goalMap: any = {
          WEIGHT_LOSS: "lose_fat",
          MUSCLE_GAIN: "gain_muscle",
          MAINTENANCE: "maintain",
          ATHLETIC_PERFORMANCE: "improve_health",
        };
        setGoal(goalMap[profileData.goal] || "lose_fat");
      }
      if (profileData.activityLevel) {
        const activityMap: any = {
          SEDENTARY: "Ít vận động",
          LIGHTLY_ACTIVE: "Vận động nhẹ",
          MODERATELY_ACTIVE: "Vận động vừa",
          VERY_ACTIVE: "Năng động",
          EXTREMELY_ACTIVE: "Cực kỳ năng động",
        };
        setActivity(activityMap[profileData.activityLevel] || "Vận động vừa");
      }
      setDateOfBirth(
        profileData.dateOfBirth
          ? String(profileData.dateOfBirth).slice(0, 10)
          : "",
      );
      setGender(profileData.gender || "");
      setHeight(profileData.heightCm?.toString() || "");
      setWeight(profileData.currentWeight?.toString() || "");
      if (profileData.dietaryPreference) setDiet(profileData.dietaryPreference);
      setExperienceLevel(profileData.experienceLevel || "");
      setCompetesInSport(Boolean(profileData.competesInSport));
      setInjuriesText(Array.isArray(profileData.injuries) ? profileData.injuries.join(", ") : "");
    }
  }, [profileData]);

  const ptStatus: "not_pt" | "pending" | "approved" = profileData?.isPT
    ? "approved"
    : "not_pt";

  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (newProfile: any) => profileService.updateProfile(newProfile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
      queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
      toast.success("Hồ sơ đã được cập nhật");
      setEditing(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || "Cập nhật hồ sơ thất bại");
    },
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => profileService.uploadPhoto(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success("Ảnh đã được cập nhật");
    },
    onError: () => toast.error("Tải ảnh lên thất bại"),
  });

  const handleSave = () => {
    updateMutation.mutate({
      goal:
        goal === "lose_fat"
          ? "WEIGHT_LOSS"
          : goal === "gain_muscle"
            ? "MUSCLE_GAIN"
            : goal === "maintain"
              ? "MAINTENANCE"
              : "ATHLETIC_PERFORMANCE",
      activityLevel:
        activity === "Ít vận động"
          ? "SEDENTARY"
          : activity === "Vận động nhẹ"
            ? "LIGHTLY_ACTIVE"
            : activity === "Vận động vừa"
              ? "MODERATELY_ACTIVE"
              : activity === "Năng động"
                ? "VERY_ACTIVE"
                : "EXTREMELY_ACTIVE",
      dateOfBirth: dateOfBirth || undefined,
      gender: gender ? gender.toUpperCase() : undefined,
      heightCm: height ? parseFloat(height) : undefined,
      currentWeight: weight ? parseFloat(weight) : undefined,
      dietaryPreference: diet,
      experienceLevel: experienceLevel || undefined,
      competesInSport,
      injuries: injuriesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const ptStatusConfig = {
    not_pt: {
      label: "Chưa đăng ký",
      bg: "bg-zinc-700/50",
      text: "text-zinc-400",
      border: "border-zinc-700",
      desc: "Đăng ký để trở thành huấn luyện viên PT được chứng nhận trên nền tảng này",
    },
    pending: {
      label: "Đang xét duyệt",
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      border: "border-amber-500/20",
      desc: "Đơn đăng ký PT của bạn đang được xem xét (2–5 ngày làm việc)",
    },
    approved: {
      label: "Đã được duyệt",
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/20",
      desc: "Bạn là huấn luyện viên PT đã được xác minh",
    },
  };

  const handleSwitchToPT = () => {
    setActiveView("pt");
    navigate("/pt/dashboard");
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <User className="w-5 h-5 text-green-400" /> Hồ sơ & Mục tiêu
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Thông tin cá nhân và tùy chọn tập luyện
          </p>
        </div>
        <button
          onClick={() => (editing ? handleSave() : setEditing(true))}
          disabled={updateMutation.isPending}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg ${
            editing
              ? "bg-green-500 text-black shadow-green-500/25 hover:bg-green-400"
              : "bg-zinc-800 text-zinc-300 border border-zinc-700/60 hover:bg-zinc-700 hover:text-zinc-100 shadow-none"
          }`}
        >
          {updateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : editing ? (
            <>
              <Check className="w-4 h-4" /> Lưu
            </>
          ) : (
            <>
              <Edit3 className="w-4 h-4" /> Chỉnh sửa
            </>
          )}
        </button>
      </div>

      {/* Weight journey — starting/current/target/progress. Spec §27:
          starting weight is the IMMUTABLE journey-start snapshot
          (profileData.startingWeight), never overwritten by later InBody
          syncs — distinct from the editable "Cân nặng (kg)" field below,
          which is the mutable current weight. Only rendered once there's
          at least a starting + current weight to show progress against. */}
      {profileData?.startingWeight != null && profileData?.currentWeight != null && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-400" /> Hành trình cân nặng
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">
                Cân nặng bắt đầu
              </p>
              <p className="text-lg font-bold text-zinc-200">
                {profileData.startingWeight} kg
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">
                Hiện tại
              </p>
              <p className="text-lg font-bold text-zinc-200">
                {profileData.currentWeight} kg
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">
                Mục tiêu
              </p>
              <p className="text-lg font-bold text-zinc-200">
                {profileData.targetWeight != null ? `${profileData.targetWeight} kg` : "Chưa đặt"}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">
                Đã thay đổi
              </p>
              <p
                className={`text-lg font-bold flex items-center gap-1 ${
                  profileData.startingWeight > profileData.currentWeight
                    ? "text-green-400"
                    : profileData.startingWeight < profileData.currentWeight
                      ? "text-amber-400"
                      : "text-zinc-400"
                }`}
              >
                {profileData.startingWeight > profileData.currentWeight ? (
                  <TrendingDown className="w-4 h-4" />
                ) : profileData.startingWeight < profileData.currentWeight ? (
                  <TrendingUp className="w-4 h-4" />
                ) : null}
                {Math.abs(
                  Math.round((profileData.startingWeight - profileData.currentWeight) * 10) / 10,
                )}{" "}
                kg
              </p>
            </div>
          </div>
          {profileData.targetWeight != null && (
            <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center gap-2 text-xs text-zinc-500">
              <Target className="w-3.5 h-3.5 text-zinc-600" />
              {Math.abs(
                Math.round((profileData.currentWeight - profileData.targetWeight) * 10) / 10,
              ) === 0
                ? "Đã đạt mục tiêu cân nặng"
                : `Còn ${Math.abs(
                    Math.round(
                      (profileData.currentWeight - profileData.targetWeight) * 10,
                    ) / 10,
                  )} kg để đạt mục tiêu`}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Avatar card */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 flex flex-col items-center text-center">
          <div className="relative group mb-3">
            {profileData?.photoUrl ? (
              <img
                src={profileData.photoUrl}
                alt="avatar"
                className="w-20 h-20 rounded-full object-cover border-2 border-green-500/30 shadow-xl shadow-green-500/10"
              />
            ) : (
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center text-black text-2xl font-bold shadow-xl shadow-green-500/20">
                {user?.firstName?.[0] || "?"}
                {user?.lastName?.[0] || ""}
              </div>
            )}
            {editing && (
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoMutation.isPending}
                className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {photoMutation.isPending ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Camera className="w-5 h-5 text-white" />
                )}
              </button>
            )}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) photoMutation.mutate(f);
              e.target.value = "";
            }}
          />
          <h2 className="text-zinc-100 font-bold">
            {user ? `${user.firstName} ${user.lastName}` : "Client"}
          </h2>
          <p className="text-zinc-500 text-sm mt-0.5">
            {isPT ? "Huấn luyện viên PT" : "Thành viên"} · Từ 2026
          </p>
          <div className="flex gap-2 mt-3 flex-wrap justify-center">
            <span className="px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-semibold rounded-full">
              Hoạt động
            </span>
            {isPT && (
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-full flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Tài khoản PT
              </span>
            )}
          </div>
          {editing && (
            <button
              onClick={() => photoInputRef.current?.click()}
              className="mt-4 w-full py-2 border border-zinc-700/60 text-sm text-zinc-500 rounded-xl hover:bg-zinc-800 hover:text-zinc-300 transition-colors flex items-center justify-center gap-2"
            >
              <Camera className="w-4 h-4" /> Đổi ảnh
            </button>
          )}
        </div>

        {/* Info fields */}
        <div className="lg:col-span-2 space-y-4">
          {/* Personal info */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">
              Thông tin cá nhân
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  label: "Họ và tên",
                  value: user ? `${user.firstName} ${user.lastName}` : "",
                },
                { label: "Email", value: user?.email || "" },
                {
                  label: "Ngày sinh",
                  value: dateOfBirth,
                  setter: setDateOfBirth,
                  type: "date",
                  maxDate: new Date().toISOString().slice(0, 10),
                },
                {
                  label: "Chiều cao (cm)",
                  value: height,
                  setter: setHeight,
                  type: "number",
                },
                {
                  label: "Cân nặng (kg)",
                  value: weight,
                  setter: setWeight,
                  type: "number",
                },
              ].map((f) => (
                <div key={f.label}>
                  <label className="text-xs text-zinc-600 mb-1 block uppercase tracking-wider">
                    {f.label}
                  </label>
                  {editing && f.setter ? (
                    <input
                      type={f.type}
                      value={f.value}
                      max={(f as any).maxDate}
                      onChange={(e) => f.setter(e.target.value)}
                      className={inputClass}
                    />
                  ) : (
                    <div className="text-sm font-medium text-zinc-300 py-2">
                      {f.value || "Chưa thiết lập"}
                    </div>
                  )}
                </div>
              ))}
              <div>
                <label className="text-xs text-zinc-600 mb-1 block uppercase tracking-wider">
                  Giới tính
                </label>
                {editing ? (
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className={selectClass}
                  >
                    {/* Without this option, a browser <select> with no
                        matching value visually defaults to showing the
                        FIRST option ("Nam") as selected — even though the
                        underlying gender state is still "" (unset). That
                        made an unset profile look like it had silently
                        become "Nam" the moment edit mode opened. */}
                    <option value="">Chưa thiết lập</option>
                    <option value="MALE">Nam</option>
                    <option value="FEMALE">Nữ</option>
                    <option value="OTHER">Khác</option>
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">
                    {gender === "MALE"
                      ? "Nam"
                      : gender === "FEMALE"
                        ? "Nữ"
                        : gender === "OTHER"
                          ? "Khác"
                          : "Chưa thiết lập"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Fitness goal */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">
              Mục tiêu tập luyện
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {goals.map((g) => (
                <button
                  key={g.key}
                  onClick={() => editing && setGoal(g.key)}
                  disabled={!editing}
                  className={`flex items-center gap-2 px-3 py-2.5 border-2 rounded-xl text-sm transition-all ${
                    goal === g.key
                      ? "border-green-500 bg-green-500/10 text-green-400 font-semibold"
                      : "border-zinc-700/60 text-zinc-500"
                  } ${editing ? "cursor-pointer hover:border-green-500/50" : "cursor-default"}`}
                >
                  <span>{g.emoji}</span>
                  <span className="text-xs">{g.label}</span>
                  {goal === g.key && <Check className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Preferences */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">
              Tùy chọn
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">
                  Mức độ hoạt động
                </label>
                {editing ? (
                  <select
                    value={activity}
                    onChange={(e) => setActivity(e.target.value)}
                    className={selectClass}
                  >
                    {activityLevels.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">
                    {activity}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">
                  Trình độ tập luyện
                </label>
                {editing ? (
                  <select
                    value={experienceLevel}
                    onChange={(e) => setExperienceLevel(e.target.value)}
                    className={selectClass}
                  >
                    {experienceLevels.map((lvl) => (
                      <option key={lvl.key} value={lvl.key}>
                        {lvl.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">
                    {experienceLevels.find((lvl) => lvl.key === experienceLevel)?.label ?? "Chưa xác định"}
                  </div>
                )}
                <p className="text-[11px] text-zinc-600 mt-1">
                  Dùng để AI không đề xuất kỹ thuật nâng cao khi trình độ chưa được xác nhận.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={competesInSport}
                    disabled={!editing}
                    onChange={(e) => setCompetesInSport(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-green-500 disabled:opacity-60"
                  />
                  Tôi đang thi đấu thể hình/thể thao chuyên nghiệp
                </label>
                <p className="text-[11px] text-zinc-600 mt-1">
                  Bật mục này để hệ thống áp dụng ngưỡng kiểm tra dữ liệu chặt chẽ hơn và không đưa lời khuyên đơn giản hoá.
                </p>
              </div>
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">
                  Chế độ ăn
                </label>
                {editing ? (
                  <select
                    value={diet}
                    onChange={(e) => setDiet(e.target.value)}
                    className={selectClass}
                  >
                    {dietPrefs.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">
                    {diet}
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">
                  Ghi chú sức khỏe
                </label>
                {editing ? (
                  <textarea
                    rows={2}
                    placeholder="Chấn thương hoặc tình trạng sức khỏe cần lưu ý, cách nhau bằng dấu phẩy..."
                    value={injuriesText}
                    onChange={(e) => setInjuriesText(e.target.value)}
                    className={`${inputClass} resize-none`}
                  />
                ) : (
                  <div className="text-sm text-zinc-400 py-2">
                    {injuriesText || "Không có chấn thương."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Training Setup → Available Equipment (gym-onboarding project §26) */}
      <button
        type="button"
        onClick={() => navigate("/client/training-equipment")}
        className="w-full flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-4 transition-all text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Dumbbell className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">Thiết bị tập luyện</div>
            <div className="text-xs text-zinc-600 mt-0.5">
              Đổi phòng gym hoặc cập nhật thiết bị bạn có — dùng để lọc bài tập phù hợp
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
      </button>

      {/* Roadmap P2 "Canonical import framework" + P2.1 "Hevy import" */}
      <button
        type="button"
        data-testid="import-workout-history-link"
        onClick={() => navigate("/client/import-workouts")}
        className="w-full flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-4 transition-all text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-500/10 border border-sky-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Upload className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">Nhập lịch sử tập luyện</div>
            <div className="text-xs text-zinc-600 mt-0.5">
              Nhập dữ liệu từ file export của Hevy — xem trước trước khi lưu
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
      </button>

      {/* Roadmap P2.5 "Export / data portability" */}
      <button
        type="button"
        data-testid="export-data-link"
        onClick={() => navigate("/client/export-data")}
        className="w-full flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-4 transition-all text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">Xuất dữ liệu</div>
            <div className="text-xs text-zinc-600 mt-0.5">
              Tải lịch sử tập luyện và số đo cơ thể về máy (JSON hoặc CSV)
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
      </button>

      {/* PT upgrade / switch banner */}
      {isPT ? (
        <div className="bg-zinc-900 border border-green-500/20 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold">
                    Tài khoản PT đang hoạt động
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
                    Đã xác minh
                  </span>
                </div>
                <p className="text-zinc-500 text-sm mt-0.5">
                  Bạn có quyền truy cập vào không gian làm việc PT với đầy đủ
                  công cụ huấn luyện.
                </p>
              </div>
            </div>
            <button
              onClick={handleSwitchToPT}
              className="flex items-center gap-2 bg-green-500 text-black px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0 self-start sm:self-auto"
            >
              <Award className="w-4 h-4" /> Vào Trainer Workspace
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 border border-zinc-700/60 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold">
                    Trở thành Huấn luyện viên PT
                  </h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${ptStatusConfig[ptStatus].bg} ${ptStatusConfig[ptStatus].text} ${ptStatusConfig[ptStatus].border}`}
                  >
                    {ptStatusConfig[ptStatus].label}
                  </span>
                </div>
                <p className="text-zinc-500 text-sm mt-0.5">
                  {ptStatusConfig[ptStatus].desc}
                </p>
              </div>
            </div>
            {ptStatus === "not_pt" && (
              <button
                onClick={() => navigate("/client/pt-application")}
                className="flex items-center gap-2 bg-green-500 text-black px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0 self-start sm:self-auto"
              >
                Đăng ký ngay <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
