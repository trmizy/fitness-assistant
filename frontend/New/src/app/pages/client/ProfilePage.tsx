import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { User, Edit3, Check, Zap, ChevronRight, Award, Loader2 } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { profileService } from "../../services/api";
import { toast } from "sonner";

const goals = [
  { key: "lose_fat",       label: "Lose Fat",       emoji: "🔥" },
  { key: "gain_muscle",    label: "Gain Muscle",     emoji: "💪" },
  { key: "gain_weight",    label: "Gain Weight",     emoji: "📈" },
  { key: "maintain",       label: "Maintain Body",   emoji: "⚖️" },
  { key: "improve_health", label: "Improve Health",  emoji: "❤️" },
];

const activityLevels = ["Sedentary", "Lightly active", "Moderately active", "Very active", "Extremely active"];
const dietPrefs      = ["No preference", "High protein", "Vegetarian", "Vegan", "Keto", "Low carb"];

const inputClass  = "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 transition-all";
const selectClass = "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 bg-zinc-800/60 text-zinc-200";

export function ProfilePage() {
  const { user, isPT, setActiveView } = useApp();
  const navigate = useNavigate();

  const { data: profileData, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.profile;
    }
  });

  const [editing,  setEditing]  = useState(false);
  const [goal,     setGoal]     = useState("lose_fat");
  const [activity, setActivity] = useState("Moderately active");
  const [diet,     setDiet]     = useState("High protein");

  const [age,    setAge]    = useState("");
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  // Sync component state with fetched profile data
  useEffect(() => {
    if (profileData) {
      if (profileData.goal) {
        const goalMap: any = {
          WEIGHT_LOSS: "lose_fat",
          MUSCLE_GAIN: "gain_muscle",
          MAINTENANCE: "maintain",
          ATHLETIC_PERFORMANCE: "improve_health"
        };
        setGoal(goalMap[profileData.goal] || "lose_fat");
      }
      if (profileData.activityLevel) {
        const activityMap: any = {
          SEDENTARY: "Sedentary",
          LIGHTLY_ACTIVE: "Lightly active",
          MODERATELY_ACTIVE: "Moderately active",
          VERY_ACTIVE: "Very active",
          EXTREMELY_ACTIVE: "Extremely active"
        };
        setActivity(activityMap[profileData.activityLevel] || "Moderately active");
      }
      setAge(profileData.age?.toString() || "");
      setGender(profileData.gender || "");
      setHeight(profileData.heightCm?.toString() || "");
      setWeight(profileData.currentWeight?.toString() || "");
    }
  }, [profileData]);

  const ptStatus: "not_pt" | "pending" | "approved" = profileData?.isPT ? "approved" : "not_pt";

  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (newProfile: any) => profileService.updateProfile(newProfile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile updated successfully");
      setEditing(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || "Failed to update profile");
    }
  });

  const handleSave = () => {
    updateMutation.mutate({
      goal: goal === "lose_fat" ? "WEIGHT_LOSS" : goal === "gain_muscle" ? "MUSCLE_GAIN" : goal === "maintain" ? "MAINTENANCE" : "ATHLETIC_PERFORMANCE",
      activityLevel: activity.toUpperCase().replace(/\s+/g, '_'),
      age: age ? parseInt(age) : undefined,
      gender: gender ? gender.toUpperCase() : undefined,
      heightCm: height ? parseFloat(height) : undefined,
      currentWeight: weight ? parseFloat(weight) : undefined,
      dietaryPreference: diet,
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
    not_pt:   { label: "Not enrolled",    bg: "bg-zinc-700/50",  text: "text-zinc-400",  border: "border-zinc-700",     desc: "Apply to become a certified personal trainer on this platform" },
    pending:  { label: "Pending Review",  bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", desc: "Your PT application is under review (2–5 business days)" },
    approved: { label: "Approved PT",     bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20", desc: "You are a verified personal trainer" },
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
            <User className="w-5 h-5 text-green-400" /> Profile & Goals
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Your personal information and fitness preferences</p>
        </div>
        <button
          onClick={() => editing ? handleSave() : setEditing(true)}
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
            <><Check className="w-4 h-4" /> Save</>
          ) : (
            <><Edit3 className="w-4 h-4" /> Edit</>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Avatar card */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center text-black text-2xl font-bold mb-3 shadow-xl shadow-green-500/20">
            {user?.firstName?.[0] || "?"}{user?.lastName?.[0] || ""}
          </div>
          <h2 className="text-zinc-100 font-bold">{user ? `${user.firstName} ${user.lastName}` : "Client"}</h2>
          <p className="text-zinc-500 text-sm mt-0.5">
            {isPT ? "Personal Trainer" : "Client"} · Member since 2026
          </p>
          <div className="flex gap-2 mt-3 flex-wrap justify-center">
            <span className="px-2.5 py-1 bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-xs font-semibold rounded-full">Week 12</span>
            <span className="px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-semibold rounded-full">Active</span>
            {isPT && (
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-full flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> PT Account
              </span>
            )}
          </div>
          {editing && (
            <button className="mt-4 w-full py-2 border border-zinc-700/60 text-sm text-zinc-500 rounded-xl hover:bg-zinc-800 hover:text-zinc-300 transition-colors">
              Change Photo
            </button>
          )}
        </div>

        {/* Info fields */}
        <div className="lg:col-span-2 space-y-4">
          {/* Personal info */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">Personal Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Full Name",    value: user ? `${user.firstName} ${user.lastName}` : "" },
                { label: "Email",        value: user?.email || "" },
                { label: "Age",          value: age,    setter: setAge,    type: "number" },
                { label: "Height (cm)",  value: height, setter: setHeight, type: "number" },
                { label: "Weight (kg)",  value: weight, setter: setWeight, type: "number" },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs text-zinc-600 mb-1 block uppercase tracking-wider">{f.label}</label>
                  {editing && f.setter ? (
                    <input
                      type={f.type}
                      value={f.value}
                      onChange={(e) => f.setter(e.target.value)}
                      className={inputClass}
                    />
                  ) : (
                    <div className="text-sm font-medium text-zinc-300 py-2">{f.value || "Not set"}</div>
                  )}
                </div>
              ))}
              <div>
                <label className="text-xs text-zinc-600 mb-1 block uppercase tracking-wider">Gender</label>
                {editing ? (
                  <select value={gender} onChange={e => setGender(e.target.value)} className={selectClass}>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">{gender || "Not set"}</div>
                )}
              </div>
            </div>
          </div>

          {/* Fitness goal */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">Fitness Goal</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {goals.map(g => (
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
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">Preferences</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">Activity Level</label>
                {editing ? (
                  <select value={activity} onChange={e => setActivity(e.target.value)} className={selectClass}>
                    {activityLevels.map(a => <option key={a}>{a}</option>)}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">{activity}</div>
                )}
              </div>
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">Dietary Preference</label>
                {editing ? (
                  <select value={diet} onChange={e => setDiet(e.target.value)} className={selectClass}>
                    {dietPrefs.map(d => <option key={d}>{d}</option>)}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">{diet}</div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">Health Notes</label>
                {editing ? (
                  <textarea rows={2} placeholder="Any injuries or medical conditions..." className={`${inputClass} resize-none`} />
                ) : (
                  <div className="text-sm text-zinc-400 py-2">No known injuries.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PT upgrade / switch banner */}
      {isPT ? (
        // PT user: show workspace switcher promo
        <div className="bg-zinc-900 border border-green-500/20 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold">PT Account Active</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/10 text-green-400 border border-green-500/20">Verified</span>
                </div>
                <p className="text-zinc-500 text-sm mt-0.5">You have access to the Trainer workspace with all coaching tools.</p>
              </div>
            </div>
            <button
              onClick={handleSwitchToPT}
              className="flex items-center gap-2 bg-green-500 text-black px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0 self-start sm:self-auto"
            >
              <Award className="w-4 h-4" /> Go to Trainer View
            </button>
          </div>
        </div>
      ) : (
        // Regular client: show "Become a PT" banner
        <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 border border-zinc-700/60 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold">Become a Personal Trainer</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${ptStatusConfig[ptStatus].bg} ${ptStatusConfig[ptStatus].text} ${ptStatusConfig[ptStatus].border}`}>
                    {ptStatusConfig[ptStatus].label}
                  </span>
                </div>
                <p className="text-zinc-500 text-sm mt-0.5">{ptStatusConfig[ptStatus].desc}</p>
              </div>
            </div>
            {ptStatus === "not_pt" && (
              <button
                onClick={() => navigate("/client/pt-application")}
                className="flex items-center gap-2 bg-green-500 text-black px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0 self-start sm:self-auto"
              >
                Apply Now <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}