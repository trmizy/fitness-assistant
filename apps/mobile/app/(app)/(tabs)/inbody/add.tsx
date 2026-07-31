import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Screen, Text, Input, Button, colors, spacing } from "../../../../src/ui";
import { inbodyApi } from "../../../../src/api/inbody";
import { inBodyEntrySchema } from "../../../../src/api/inbodySchemas";
import { getApiErrorMessage } from "../../../../src/api/client";
import { queryKeys, useActiveCycleQuery } from "../../../../src/api/queries";
import { daysBetween } from "../../../../src/lib/date";
import { env } from "../../../../src/config/env";
import { CloseCycleSheet } from "../../../../src/features/inbody/CloseCycleSheet";

interface FormRaw {
  weight: string;
  bodyFat: string;
  bodyFatPct: string;
  muscleMass: string;
  visceralFat: string;
  bmr: string;
  height: string;
  notes: string;
}

const DEFAULTS: FormRaw = {
  weight: "",
  bodyFat: "",
  bodyFatPct: "",
  muscleMass: "",
  visceralFat: "",
  bmr: "",
  height: "",
  notes: "",
};

export default function AddInBodyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeCycleData } = useActiveCycleQuery();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdEntryId, setCreatedEntryId] = useState<string | null>(null);

  const { control, handleSubmit, setError, formState } = useForm<FormRaw>({
    defaultValues: DEFAULTS,
  });

  const onSubmit = async (raw: FormRaw) => {
    setSubmitError(null);
    const parsed = inBodyEntrySchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FormRaw;
        setError(field, { message: issue.message });
      }
      return;
    }
    try {
      const entry = await inbodyApi.create(parsed.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inbodyLatest }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inbodyHistory }),
      ]);

      const cycle = activeCycleData?.cycle;
      const nearCycleEnd =
        env.featureCycles && cycle && daysBetween(entry.date, cycle.endDate) <= 3;

      if (nearCycleEnd) {
        setCreatedEntryId(entry.id);
      } else {
        router.back();
      }
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "Không thể lưu bản ghi InBody"));
    }
  };

  return (
    <Screen scroll>
      <Text variant="heading">Thêm bản ghi InBody</Text>

      <View style={{ gap: spacing.md }}>
        <NumField control={control} name="weight" label="Cân nặng (kg)*" />
        <NumField control={control} name="bodyFat" label="Khối lượng mỡ (kg)*" />
        <NumField control={control} name="bodyFatPct" label="% Mỡ cơ thể" />
        <NumField control={control} name="muscleMass" label="Khối cơ SMM (kg)*" />
        <NumField control={control} name="visceralFat" label="Mỡ nội tạng" />
        <NumField control={control} name="bmr" label="BMR (kcal/ngày)" />
        <NumField control={control} name="height" label="Chiều cao (cm)" />
        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <Input label="Ghi chú" value={field.value} onChangeText={field.onChange} multiline />
          )}
        />

        {submitError ? (
          <Text variant="caption" color={colors.danger}>
            {submitError}
          </Text>
        ) : null}

        <Button
          label="Lưu bản ghi"
          onPress={handleSubmit(onSubmit)}
          loading={formState.isSubmitting}
          fullWidth
        />
      </View>

      <CloseCycleSheet
        visible={createdEntryId !== null}
        cycle={activeCycleData?.cycle ?? null}
        entryId={createdEntryId}
        onDismiss={() => {
          setCreatedEntryId(null);
          router.back();
        }}
      />
    </Screen>
  );
}

function NumField({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<FormRaw>>["control"];
  name: keyof FormRaw;
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Input
          label={label}
          value={field.value}
          onChangeText={field.onChange}
          keyboardType="decimal-pad"
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
