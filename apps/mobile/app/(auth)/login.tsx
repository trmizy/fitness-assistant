import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Screen, Text, Button, Input, colors, spacing } from "../../src/ui";
import { useAuthStore } from "../../src/store/authStore";
import { loginSchema, type LoginFormValues } from "../../src/api/authSchemas";
import { getApiErrorMessage } from "../../src/api/client";
import { strings } from "../../src/i18n/strings";

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      await login(values.email, values.password);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, strings.auth.loginFailed));
    }
  };

  return (
    <Screen scroll style={{ justifyContent: "center", flexGrow: 1 }}>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <Text variant="heading">{strings.auth.loginTitle}</Text>
        <Text variant="caption">Gym Coach</Text>
      </View>

      <View style={{ gap: spacing.md }}>
        <Controller
          control={control}
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
          control={control}
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
          label={strings.auth.loginButton}
          onPress={handleSubmit(onSubmit)}
          loading={isSubmitting}
          fullWidth
          style={{ marginTop: spacing.sm }}
        />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xs, marginTop: spacing.xl }}>
        <Text variant="caption">{strings.auth.noAccount}</Text>
        <Link href="/(auth)/register">
          <Text variant="caption" color={colors.accent}>
            {strings.auth.goToRegister}
          </Text>
        </Link>
      </View>
    </Screen>
  );
}
