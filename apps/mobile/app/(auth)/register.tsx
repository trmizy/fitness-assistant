import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Screen, Text, Button, Input, colors, spacing } from "../../src/ui";
import { useAuthStore } from "../../src/store/authStore";
import { authApi } from "../../src/api/auth";
import {
  registerSchema,
  otpSchema,
  type RegisterFormValues,
  type OtpFormValues,
} from "../../src/api/authSchemas";
import { getApiErrorMessage } from "../../src/api/client";
import { strings } from "../../src/i18n/strings";

export default function RegisterScreen() {
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const setSessionFromRegistration = useAuthStore((s) => s.setSessionFromRegistration);

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", firstName: "", lastName: "" },
  });

  const otpForm = useForm<OtpFormValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: "" },
  });

  const onSubmitRegister = async (values: RegisterFormValues) => {
    setSubmitError(null);
    try {
      await authApi.register(values.email, values.password, values.firstName, values.lastName);
      setEmail(values.email);
      setStep("otp");
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, strings.auth.genericError));
    }
  };

  const onSubmitOtp = async (values: OtpFormValues) => {
    setSubmitError(null);
    try {
      const { user, ...tokens } = await authApi.verifyRegistration(email, values.otp);
      await setSessionFromRegistration(user, tokens);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, strings.auth.genericError));
    }
  };

  if (step === "otp") {
    return (
      <Screen scroll style={{ justifyContent: "center", flexGrow: 1 }}>
        <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
          <Text variant="heading">{strings.auth.otpTitle}</Text>
          <Text variant="caption">{strings.auth.otpDescription}</Text>
        </View>

        <View style={{ gap: spacing.md }}>
          <Controller
            control={otpForm.control}
            name="otp"
            render={({ field, fieldState }) => (
              <Input
                label="OTP"
                keyboardType="number-pad"
                maxLength={6}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />

          {submitError ? (
            <Text variant="caption" color={colors.danger}>
              {submitError}
            </Text>
          ) : null}

          <Button
            label={strings.auth.otpButton}
            onPress={otpForm.handleSubmit(onSubmitOtp)}
            loading={otpForm.formState.isSubmitting}
            fullWidth
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll style={{ justifyContent: "center", flexGrow: 1 }}>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <Text variant="heading">{strings.auth.registerTitle}</Text>
        <Text variant="caption">Gym Coach</Text>
      </View>

      <View style={{ gap: spacing.md }}>
        <Controller
          control={registerForm.control}
          name="firstName"
          render={({ field }) => (
            <Input label={strings.auth.firstName} value={field.value} onChangeText={field.onChange} />
          )}
        />
        <Controller
          control={registerForm.control}
          name="lastName"
          render={({ field }) => (
            <Input label={strings.auth.lastName} value={field.value} onChangeText={field.onChange} />
          )}
        />
        <Controller
          control={registerForm.control}
          name="email"
          render={({ field, fieldState }) => (
            <Input
              label={strings.auth.email}
              autoCapitalize="none"
              keyboardType="email-address"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={registerForm.control}
          name="password"
          render={({ field, fieldState }) => (
            <Input
              label={strings.auth.password}
              secureTextEntry
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        {submitError ? (
          <Text variant="caption" color={colors.danger}>
            {submitError}
          </Text>
        ) : null}

        <Button
          label={strings.auth.registerButton}
          onPress={registerForm.handleSubmit(onSubmitRegister)}
          loading={registerForm.formState.isSubmitting}
          fullWidth
          style={{ marginTop: spacing.sm }}
        />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xs, marginTop: spacing.xl }}>
        <Text variant="caption">{strings.auth.hasAccount}</Text>
        <Link href="/(auth)/login">
          <Text variant="caption" color={colors.accent}>
            {strings.auth.goToLogin}
          </Text>
        </Link>
      </View>
    </Screen>
  );
}
