import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import { ArrowRight, Check, Dumbbell, Lock, Mail, UserCircle } from "lucide-react-native";

import { Button, Input, useToast } from "../../src/components/ui";
import { useApp } from "../../src/context/AppContext";
import { authService } from "../../src/services/api";
import { ONBOARDING_PATH } from "../../src/config/landing";
import { designTokens } from "../../src/theme/colors";
import { useWorkspaceAccent } from "../../src/theme/workspace";

/**
 * Registration: account details, then the emailed 6-digit code. Two steps, not the five web once
 * had — web cut the profile/goal steps because `OnboardingWizardPage` is the SINGLE place that
 * collects a profile, and keeping a second half-built copy meant every new user clicked through
 * two back-to-back wizards. Verifying therefore lands on the onboarding route directly, which is
 * where the guard would send them anyway.
 */
export default function RegisterScreen() {
  const [step, setStep] = useState<0 | 1>(0);
  const [email, setEmail] = useState("");

  return step === 0 ? (
    <AccountStep
      onSent={(sentTo) => {
        setEmail(sentTo);
        setStep(1);
      }}
    />
  ) : (
    <OtpStep email={email} />
  );
}

function AccountStep({ onSent }: { onSent: (email: string) => void }) {
  const toast = useToast();
  const accent = useWorkspaceAccent();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    Keyboard.dismiss();
    if (!email.trim() || !password || !fullName.trim()) {
      toast.show("Vui lòng điền đầy đủ thông tin", "danger");
      return;
    }

    setLoading(true);
    try {
      // The backend takes firstName/lastName separately while the form asks for one name, so the
      // split happens here exactly as web does it — including the "." fallback, because a
      // single-word name would otherwise send an empty lastName the API rejects.
      const parts = fullName.trim().split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || ".";

      await authService.register(email.trim(), password, firstName, lastName);
      toast.show("Mã xác nhận đã được gửi đến email của bạn");
      onSent(email.trim());
    } catch (error: any) {
      const message = error?.response?.data?.error || "";
      if (message === "Email already registered") {
        toast.show("Email này đã được đăng ký — hãy đăng nhập.", "danger");
      } else if (!error?.response) {
        toast.show("Không kết nối được máy chủ.", "danger");
      } else {
        toast.show(message || "Đăng ký thất bại", "danger");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow px-6 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-8 mt-4 h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          <Dumbbell size={28} strokeWidth={2.5} color={accent.onPrimary} />
        </View>

        <Text className="font-display text-3xl text-foreground">Tạo tài khoản</Text>
        <Text className="mt-2 font-body text-muted-foreground">
          Bắt đầu hành trình thể hình cùng AI
        </Text>

        <View className="mt-8 gap-3">
          <Input
            icon={UserCircle}
            placeholder="Họ và tên"
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />
          <Input
            icon={Mail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Input
            icon={Lock}
            placeholder="Mật khẩu"
            secureTextEntry
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            onSubmitEditing={handleRegister}
            returnKeyType="go"
          />
        </View>

        <Button
          full
          size="lg"
          icon={ArrowRight}
          className="mt-8"
          disabled={loading}
          onPress={handleRegister}
        >
          {loading ? "Đang gửi mã..." : "Tiếp tục"}
        </Button>

        <View className="mt-auto pt-8">
          <Text className="text-center text-sm font-body text-muted-foreground">
            Đã có tài khoản?{" "}
            <Link href="/login" className="font-body-semibold text-primary">
              Đăng nhập
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const OTP_LENGTH = 6;
/** auth-service's OTP_RESEND_SECONDS default. The server's own response overrides it after a
 *  resend; the first countdown starts from this because the code was sent the moment this step
 *  opened. */
const RESEND_AFTER_SECONDS = 60;

function OtpStep({ email }: { email: string }) {
  const { setUser } = useApp();
  const toast = useToast();
  const accent = useWorkspaceAccent();

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_AFTER_SECONDS);
  const inputs = useRef<(TextInput | null)[]>([]);

  const code = digits.join("");
  const filled = code.length === OTP_LENGTH;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const setDigit = (index: number, value: string) => {
    // A soft keyboard can deliver a whole pasted code to one box; spread it across the rest
    // instead of keeping only the first character.
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length > 1) {
      setDigits((prev) => {
        const next = [...prev];
        for (let offset = 0; offset < cleaned.length && index + offset < OTP_LENGTH; offset++) {
          next[index + offset] = cleaned[offset];
        }
        return next;
      });
      inputs.current[Math.min(index + cleaned.length, OTP_LENGTH - 1)]?.focus();
      return;
    }

    setDigits((prev) => {
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
    if (cleaned && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  /** Backspace on an empty box steps back, which is what every OTP field on a phone does. */
  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    Keyboard.dismiss();
    if (!filled) {
      toast.show("Vui lòng nhập đủ 6 số", "danger");
      return;
    }

    setLoading(true);
    try {
      const result = await authService.verifyRegistration(email, code);
      if (result.success) {
        setUser(result.user);
        toast.show("Xác minh email thành công");
        router.replace(ONBOARDING_PATH);
      } else {
        toast.show("Xác minh thất bại", "danger");
      }
    } catch (error: any) {
      toast.show(error?.response?.data?.error || "Xác minh thất bại", "danger");
    } finally {
      setLoading(false);
    }
  };

  /**
   * GAP-5: a real resend. The pending sign-up keeps the password and name from step one, so only
   * the code changes — which is why the boxes are cleared: whatever was typed belongs to the code
   * that just stopped working.
   */
  const handleResend = async () => {
    if (resending || resendIn > 0) return;
    setResending(true);
    try {
      const result = await authService.resendRegistrationOtp(email);
      setDigits(Array(OTP_LENGTH).fill(""));
      inputs.current[0]?.focus();
      setResendIn(result?.resendAfterSeconds ?? RESEND_AFTER_SECONDS);
      toast.show("Đã gửi mã mới — mã cũ không còn dùng được");
    } catch (error: any) {
      if (!error?.response) {
        toast.show("Không kết nối được máy chủ.", "danger");
      } else {
        toast.show(error.response.data?.error || "Không gửi lại được mã", "danger");
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow px-6 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-8 mt-4 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <Mail size={26} color={accent.primary} />
        </View>

        <Text className="font-display text-3xl text-foreground">Xác thực email</Text>
        <Text className="mt-2 font-body text-muted-foreground">
          Nhập mã 6 số vừa gửi tới{" "}
          <Text className="font-body-semibold text-foreground">{email}</Text>
        </Text>

        <View className="mt-8 flex-row justify-between gap-2">
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              value={digit}
              onChangeText={(value) => setDigit(index, value)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              editable={!loading}
              selectionColor={accent.primary}
              className={`h-14 w-12 rounded-xl border bg-panel text-center font-display text-2xl text-foreground ${
                digit ? "border-primary" : "border-border"
              }`}
              placeholderTextColor={designTokens.mutedForeground}
            />
          ))}
        </View>

        <Text
          className="mt-6 text-center text-sm font-body text-muted-foreground"
          onPress={resendIn > 0 || resending ? undefined : handleResend}
        >
          Chưa nhận được mã?{" "}
          {resendIn > 0 ? (
            <Text className="font-body-medium text-muted-foreground">Gửi lại sau {resendIn}s</Text>
          ) : (
            <Text className="font-body-semibold text-primary">
              {resending ? "Đang gửi..." : "Gửi lại"}
            </Text>
          )}
        </Text>

        <Button
          full
          size="lg"
          icon={Check}
          className="mt-8"
          disabled={loading || !filled}
          onPress={handleVerify}
        >
          {loading ? "Đang xác minh..." : filled ? "Xác nhận" : "Nhập đủ 6 số"}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
