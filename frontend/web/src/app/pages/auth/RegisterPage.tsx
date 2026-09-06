import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApp } from "../../context/AppContext";
import { BarbellIcon as Dumbbell, ArrowRightIcon as ArrowRight, CheckIcon as Check, EnvelopeSimpleIcon as Mail, LockIcon as Lock, UserCircleIcon as UserCircle } from "@phosphor-icons/react";
import { authService } from "../../services/api";
import { toast } from "sonner";

/**
 * Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.1.
 * Used to have 5 steps (Tài khoản → OTP → Hồ sơ → Mục tiêu → Xong): the "Hồ sơ"/"Mục
 * tiêu" steps collected age/gender/height/weight/goal/activityLevel through their own
 * incomplete, buggy copy of what OnboardingWizardPage already asks properly (missing
 * experienceLevel entirely, activityLevel silently hard-coded to LIGHTLY_ACTIVE with no
 * UI to change it, and "ATHLETIC_PERFORMANCE" mislabeled "Cải thiện sức khỏe" — contradicting
 * OnboardingWizardPage's correct "Hiệu suất thể thao" for the same enum value) — AND never
 * set `hasCompletedOnboarding`, so `RequireOnboarding` redirected straight to
 * OnboardingWizardPage immediately afterward regardless, making every new user click through
 * two back-to-back wizards (up to 11 screens) before ever reaching the dashboard. Now just
 * account creation + OTP verification; OnboardingWizardPage is the SINGLE place that collects
 * the profile, once, correctly.
 */
const steps = ["Tài khoản", "Xác nhận"];

export function RegisterPage() {
  const { setUser } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const handleRegister = async () => {
    if (!email || !password || !fullName) {
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }

    setLoading(true);
    try {
      const parts = fullName.trim().split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || ".";

      await authService.register(email, password, firstName, lastName);
      toast.success("Mã xác nhận đã được gửi đến email của bạn");
      setStep(1);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || "";
      if (errorMsg === "Email already registered") {
        toast.error("Email này đã được đăng ký. Bạn có muốn đăng nhập không?", {
          action: {
            label: "Đăng nhập ngay",
            onClick: () => navigate("/login"),
          },
          duration: 5000,
        });
      } else {
        toast.error(errorMsg || "Đăng ký thất bại");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!otp) {
      toast.error("Vui lòng nhập mã xác nhận");
      return;
    }

    setLoading(true);
    try {
      const result = await authService.verifyRegistration(email, otp);
      if (result.success) {
        setUser(result.user);
        toast.success("Xác minh email thành công — hãy thiết lập hồ sơ tập luyện của bạn");
        // Straight into the ONE real onboarding flow — RequireOnboarding would have
        // forced this redirect anyway (hasCompletedOnboarding is still false for a
        // brand-new account), so going there directly instead of via /client/dashboard
        // skips a guaranteed extra redirect hop.
        navigate("/client/onboarding", { replace: true });
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Xác minh thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
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
            <span className="text-white font-bold tracking-tight uppercase">
              Fitness AI
            </span>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all ${
                    i < step
                      ? "bg-green-500 text-black"
                      : i === step
                        ? "bg-zinc-100 text-zinc-900"
                        : "bg-zinc-700 text-zinc-500"
                  }`}
                >
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 rounded-full transition-all ${i < step ? "bg-green-500" : "bg-zinc-700"}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 0: Tài khoản */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="mb-2">
                <h2 className="text-xl font-bold text-zinc-100">
                  Tạo tài khoản
                </h2>
                <p className="text-sm text-zinc-500">
                  Gia nhập cộng đồng thể dục của chúng tôi
                </p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 text-zinc-200"
                    placeholder="Họ và tên"
                  />
                </div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 text-zinc-200"
                    placeholder="Địa chỉ email"
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 text-zinc-200"
                    placeholder="Mật khẩu"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Xác nhận OTP */}
          {step === 1 && (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100">
                Kiểm tra email của bạn
              </h2>
              <p className="text-sm text-zinc-500 px-4">
                Chúng tôi đã gửi mã xác nhận 6 chữ số đến{" "}
                <span className="text-zinc-200 font-semibold">{email}</span>
              </p>

              <input
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="w-full bg-zinc-800 border-2 border-zinc-700 rounded-xl py-3 text-center text-2xl font-bold tracking-[0.5em] text-green-500 focus:border-green-500 outline-none transition-all"
                placeholder=""
              />

              <button
                onClick={handleRegister}
                className="text-xs text-zinc-500 hover:text-green-500 transition-colors"
                disabled={loading}
              >
                Không nhận được mã? Gửi lại
              </button>
            </div>
          )}

          {/* Navigation */}
          <div className="mt-8 flex gap-3">
            {step === 1 && (
              <button
                onClick={() => setStep(0)}
                className="px-4 py-2.5 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-semibold hover:bg-zinc-700 transition-all border border-zinc-700"
              >
                Quay lại
              </button>
            )}

            {step === 0 && (
              <button
                onClick={handleRegister}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-500 text-black rounded-xl font-bold hover:bg-green-400 transition-all flex items-center justify-center gap-2"
              >
                {loading ? "Đang gửi..." : "Tiếp tục"}{" "}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 1 && (
              <button
                onClick={handleVerify}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-500 text-black rounded-xl font-bold hover:bg-green-400 transition-all flex items-center justify-center gap-2"
              >
                {loading ? "Đang xác minh..." : "Xác minh mã"}{" "}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {step === 0 && (
            <p className="text-center text-sm text-zinc-500 mt-6">
              Đã có tài khoản?{" "}
              <Link
                to="/login"
                className="text-green-500 font-semibold hover:underline"
              >
                Đăng nhập
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
