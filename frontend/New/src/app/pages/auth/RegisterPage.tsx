import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useApp, UserRole } from "../../context/AppContext";
import { Dumbbell, User, Zap, ArrowRight, ArrowLeft, Check, Mail, Lock, UserCircle } from "lucide-react";
import { authService, profileService } from "../../services/api";
import { toast } from "sonner";

const steps = ["Account", "Verify", "Profile", "Goals", "Done"];

export function RegisterPage() {
  const { login, setUser } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Form State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  
  // Profile State
  const [profile, setProfile] = useState({
    age: "",
    gender: "MALE", // Changed default to uppercase to match backend enum
    heightCm: "",
    currentWeight: "",
    activityLevel: "MODERATELY_ACTIVE",
    goal: "WEIGHT_LOSS"
  });

  const goals = [
    { key: "WEIGHT_LOSS",        label: "Lose Fat",        emoji: "🔥" },
    { key: "MUSCLE_GAIN",     label: "Gain Muscle",     emoji: "💪" },
    { key: "MAINTENANCE",        label: "Maintain Body",   emoji: "⚖️" },
    { key: "ATHLETIC_PERFORMANCE",  label: "Improve Health",  emoji: "❤️" },
  ];

  const handleRegister = async () => {
    if (!email || !password || !fullName) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      const parts = fullName.trim().split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || ".";
      
      await authService.register(email, password, firstName, lastName);
      toast.success("Verification code sent to your email");
      setStep(1); // Move to Verify step
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!otp) {
      toast.error("Please enter the verification code");
      return;
    }

    setLoading(true);
    try {
      const result = await authService.verifyRegistration(email, otp);
      if (result.success) {
        setUser(result.user);
        toast.success("Email verified successfully");
        setStep(2); // Move to Profile step
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      const ageVal = parseInt(profile.age);
      const heightVal = parseFloat(profile.heightCm);
      const weightVal = parseFloat(profile.currentWeight);

      const payload: any = {
        gender: profile.gender.toUpperCase(),
        activityLevel: profile.activityLevel,
        goal: profile.goal.toUpperCase()
      };

      if (!isNaN(ageVal) && ageVal > 0) payload.age = ageVal;
      if (!isNaN(heightVal) && heightVal > 0) payload.heightCm = heightVal;
      if (!isNaN(weightVal) && weightVal > 0) payload.currentWeight = weightVal;

      await profileService.updateProfile(payload);
      setStep(4); // Move to Done
    } catch (error: any) {
      console.error("Profile update error:", error);
      toast.error("Failed to update profile features");
      setStep(4); // Show "Done" UI anyway
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = () => {
    // Session is already set in localStorage by verifyRegistration
    window.location.href = "/client/dashboard";
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-green-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-green-500/3 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800/60 overflow-hidden">
        {/* Header */}
        <div className="relative px-6 py-5 border-b border-zinc-800/60">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-500" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-green-500 rounded-lg flex items-center justify-center">
              <Dumbbell className="w-4 h-4 text-black" />
            </div>
            <span className="text-white font-bold tracking-tight uppercase">Fitness AI</span>
          </div>
          
          {/* Stepper */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all ${
                  i < step   ? "bg-green-500 text-black"
                  : i === step ? "bg-zinc-100 text-zinc-900"
                               : "bg-zinc-700 text-zinc-500"
                }`}>
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all ${i < step ? "bg-green-500" : "bg-zinc-700"}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 0: Base Credentials */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="mb-2">
                <h2 className="text-xl font-bold text-zinc-100">Create account</h2>
                <p className="text-sm text-zinc-500">Join our fitness community today</p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input 
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 text-zinc-200" 
                    placeholder="Full name" 
                  />
                </div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 text-zinc-200" 
                    placeholder="Email address" 
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 text-zinc-200" 
                    placeholder="Password" 
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Verify OTP */}
          {step === 1 && (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100">Check your email</h2>
              <p className="text-sm text-zinc-500 px-4">
                We've sent a 6-digit verification code to <span className="text-zinc-200 font-semibold">{email}</span>
              </p>
              
              <input 
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-zinc-800 border-2 border-zinc-700 rounded-xl py-3 text-center text-2xl font-bold tracking-[0.5em] text-green-500 focus:border-green-500 outline-none transition-all"
                placeholder="000000"
              />
              
              <button 
                onClick={handleRegister}
                className="text-xs text-zinc-500 hover:text-green-500 transition-colors"
                disabled={loading}
              >
                Didn't receive code? Resend
              </button>
            </div>
          )}

          {/* Step 2: Profile */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-100">Your profile</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block uppercase font-bold">Age</label>
                  <input 
                    value={profile.age}
                    onChange={(e) => setProfile({...profile, age: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-green-500" 
                    placeholder="25" 
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block uppercase font-bold tracking-wider">Gender</label>
                  <select 
                    value={profile.gender}
                    onChange={(e) => setProfile({...profile, gender: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-green-500 transition-all cursor-pointer"
                  >
                    <option value="MALE">Male ♂</option>
                    <option value="FEMALE">Female ♀</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block uppercase font-bold">Height (cm)</label>
                  <input 
                    value={profile.heightCm}
                    onChange={(e) => setProfile({...profile, heightCm: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-green-500" 
                    placeholder="175" 
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block uppercase font-bold">Weight (kg)</label>
                  <input 
                    value={profile.currentWeight}
                    onChange={(e) => setProfile({...profile, currentWeight: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-green-500" 
                    placeholder="70" 
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Goals */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-100">Select your goal</h2>
              <div className="space-y-2">
                {goals.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => setProfile({...profile, goal: g.key})}
                    className={`flex items-center gap-3 w-full px-4 py-3 border rounded-xl transition-all text-left ${
                      profile.goal === g.key ? "border-green-500 bg-green-500/10" : "border-zinc-700 hover:border-zinc-600"
                    }`}
                  >
                    <span className="text-xl">{g.emoji}</span>
                    <span className={`text-sm font-semibold ${profile.goal === g.key ? "text-green-500" : "text-zinc-300"}`}>{g.label}</span>
                    {profile.goal === g.key && <Check className="w-4 h-4 text-green-500 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="text-center py-6 space-y-3">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto border border-green-500/20">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-100">Welcome aboard!</h2>
              <p className="text-zinc-500">Your professional fitness profile is ready.</p>
            </div>
          )}

          {/* Navigation */}
          <div className="mt-8 flex gap-3">
            {step > 0 && step < 4 && (
              <button 
                onClick={() => setStep(step - 1)}
                className="px-4 py-2.5 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-semibold hover:bg-zinc-700 transition-all border border-zinc-700"
              >
                Back
              </button>
            )}
            
            {step === 0 && (
              <button 
                onClick={handleRegister}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-500 text-black rounded-xl font-bold hover:bg-green-400 transition-all flex items-center justify-center gap-2"
              >
                {loading ? "Sending..." : "Continue"} <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 1 && (
              <button 
                onClick={handleVerify}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-500 text-black rounded-xl font-bold hover:bg-green-400 transition-all flex items-center justify-center gap-2"
              >
                {loading ? "Verifying..." : "Verify Code"} <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {(step === 2 || step === 3) && (
              <button 
                onClick={() => step === 2 ? setStep(3) : handleSaveProfile()}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-500 text-black rounded-xl font-bold hover:bg-green-400 transition-all flex items-center justify-center gap-2"
              >
                {loading ? "Saving..." : "Continue"} <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 4 && (
              <button 
                onClick={handleFinish}
                className="flex-1 py-3 bg-green-500 text-black rounded-xl font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20"
              >
                Go to Dashboard
              </button>
            )}
          </div>

          {step === 0 && (
            <p className="text-center text-sm text-zinc-500 mt-6">
              Already have an account? <Link to="/login" className="text-green-500 font-semibold hover:underline">Sign in</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
