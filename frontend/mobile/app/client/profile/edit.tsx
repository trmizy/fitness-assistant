import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Target, TrendingDown, TrendingUp } from "lucide-react-native";

import { Avatar, Button, Card, Input, ScreenHeader, useToast } from "../../../src/components/ui";
import { profileService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { Chip, FieldLabel } from "../../../src/features/plans/PlanWidgets";
import {
  ACTIVITY_OPTIONS,
  DIET_OPTIONS,
  EXPERIENCE_OPTIONS,
  GENDER_OPTIONS,
  GOAL_OPTIONS,
  dateOfBirthError,
  formFromProfile,
  profilePatch,
  type ProfileForm,
} from "../../../src/features/profile/profile";

/**
 * CL-05 — "Chỉnh sửa hồ sơ": web's ProfilePage form (the design only drew the hub). Same fields,
 * same `PUT /profile/me` body, same photo upload (`POST /profile/me/photo`). After a save the
 * workout program/schedule queries are refreshed too, as on web — goal and experience feed plan
 * generation.
 *
 * Units: shown and edited in cm/kg, the canonical storage units. Web's imperial display toggle
 * lives in Settings and is not ported yet (MOBILE_MIGRATION_MANIFEST.md, CL-05 note).
 */
export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const userId = user?.id ?? "guest";

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => (await profileService.getProfile())?.profile ?? null,
    enabled: !!user?.id,
  });
  const profile: any = profileQuery.data;

  // Untouched fields follow the loaded profile; the first edit takes a private copy.
  const [edited, setEdited] = useState<ProfileForm | null>(null);
  const form = edited ?? (profile ? formFromProfile(profile) : null);
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setEdited((f) => ({ ...(f ?? form!), [k]: v }));

  const save = useMutation({
    mutationFn: (f: ProfileForm) => profileService.updateProfile(profilePatch(f)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      void queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
      void queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
      toast.show("Hồ sơ đã được cập nhật", "success");
      router.back();
    },
    onError: (e: any) => toast.show(e?.response?.data?.error?.message ?? e?.response?.data?.error ?? "Cập nhật hồ sơ thất bại", "danger"),
  });

  const photo = useMutation({
    mutationFn: (file: { uri: string; name: string; type: string }) => profileService.uploadPhoto(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      toast.show("Ảnh đã được cập nhật", "success");
    },
    onError: () => toast.show("Tải ảnh lên thất bại", "danger"),
  });

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show("Cần quyền truy cập ảnh.", "danger");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;
    const type = a.mimeType ?? "image/jpeg";
    photo.mutate({ uri: a.uri, name: a.fileName ?? `avatar.${type.includes("png") ? "png" : "jpg"}`, type });
  };

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Bạn";
  const dobError = form ? dateOfBirthError(form.dateOfBirth) : null;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/client/profile"));

  if (profileQuery.isLoading || !form) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Chỉnh sửa hồ sơ" onBack={back} />
        <View className="flex-1 items-center justify-center">
          {profileQuery.isError ? (
            <Text className="font-body text-sm text-destructive">Không tải được hồ sơ.</Text>
          ) : (
            <ActivityIndicator color={accent.primary} />
          )}
        </View>
      </View>
    );
  }

  const start = profile?.startingWeight;
  const current = profile?.currentWeight;
  const target = profile?.targetWeight;
  const change = start != null && current != null ? Math.round((start - current) * 10) / 10 : null;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Chỉnh sửa hồ sơ" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View className="items-center">
          <Pressable accessibilityLabel="Đổi ảnh đại diện" onPress={() => void pickPhoto()} disabled={photo.isPending}>
            <Avatar uri={profile?.photoUrl} name={name} size={88} />
            <View className="absolute bottom-0 right-0 h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary">
              {photo.isPending ? <ActivityIndicator size="small" color={accent.onPrimary} /> : <Camera size={15} color={accent.onPrimary} />}
            </View>
          </Pressable>
          <Text className="mt-3 font-display text-lg text-foreground">{name}</Text>
          <Text className="font-body text-sm text-muted-foreground">{user?.email}</Text>
        </View>

        {start != null && current != null ? (
          <Card className="p-4">
            <Text className="mb-3 font-body-semibold text-sm text-foreground">Hành trình cân nặng</Text>
            <View className="flex-row flex-wrap">
              <Journey label="Bắt đầu" value={`${start} kg`} />
              <Journey label="Hiện tại" value={`${current} kg`} />
              <Journey label="Mục tiêu" value={target != null ? `${target} kg` : "Chưa đặt"} />
              <View className="w-1/2 py-1.5">
                <Text className="font-body text-[11px] text-muted-foreground">Đã thay đổi</Text>
                <View className="flex-row items-center gap-1">
                  {change != null && change > 0 ? <TrendingDown size={15} color={accent.primary} /> : change != null && change < 0 ? <TrendingUp size={15} color={designTokens.warning} /> : null}
                  <Text className={`font-display text-lg ${change != null && change > 0 ? "text-primary" : change != null && change < 0 ? "text-warning" : "text-foreground"}`}>
                    {Math.abs(change ?? 0)} kg
                  </Text>
                </View>
              </View>
            </View>
            {target != null ? (
              <View className="mt-2 flex-row items-center gap-1.5 border-t border-border pt-2">
                <Target size={13} color={designTokens.mutedForeground} />
                <Text className="font-body text-xs text-muted-foreground">
                  {Math.round(Math.abs(current - target) * 10) / 10 === 0 ? "Đã đạt mục tiêu cân nặng" : `Còn ${Math.round(Math.abs(current - target) * 10) / 10} kg để đạt mục tiêu`}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card className="gap-3 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Thông tin cơ bản</Text>
          <Input label="Ngày sinh" value={form.dateOfBirth} onChangeText={(t) => set("dateOfBirth", t)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" error={dobError ?? undefined} />
          <View>
            <FieldLabel>Giới tính</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {GENDER_OPTIONS.map((g) => (
                <Chip key={g.value} label={g.label} active={form.gender === g.value} onPress={() => set("gender", g.value)} />
              ))}
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input label="Chiều cao (cm)" value={form.heightCm} onChangeText={(t) => set("heightCm", t)} keyboardType="decimal-pad" />
            </View>
            <View className="flex-1">
              <Input label="Cân nặng (kg)" value={form.currentWeight} onChangeText={(t) => set("currentWeight", t)} keyboardType="decimal-pad" />
            </View>
          </View>
        </Card>

        <Card className="gap-3 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Mục tiêu</Text>
          <View className="flex-row flex-wrap gap-2">
            {GOAL_OPTIONS.map((g) => (
              <Chip key={g.value} label={`${g.emoji} ${g.label}`} active={form.goal === g.value} onPress={() => set("goal", g.value)} />
            ))}
          </View>
        </Card>

        <Card className="gap-3 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Tập luyện & dinh dưỡng</Text>
          <View>
            <FieldLabel>Mức vận động</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {ACTIVITY_OPTIONS.map((a) => (
                <Chip key={a.value} label={a.label} active={form.activityLevel === a.value} onPress={() => set("activityLevel", a.value)} />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Trình độ tập</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {EXPERIENCE_OPTIONS.map((x) => (
                <Chip key={x.value || "none"} label={x.label} active={form.experienceLevel === x.value} onPress={() => set("experienceLevel", x.value)} />
              ))}
            </View>
          </View>
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 font-body text-sm text-foreground">Tôi là vận động viên thi đấu</Text>
            <Switch value={form.competesInSport} onValueChange={(v) => set("competesInSport", v)} trackColor={{ true: accent.primary }} />
          </View>
          <View>
            <FieldLabel>Chế độ ăn</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {DIET_OPTIONS.map((d) => (
                <Chip key={d} label={d} active={form.dietaryPreference === d} onPress={() => set("dietaryPreference", d)} />
              ))}
            </View>
          </View>
          <Input label="Chấn thương / hạn chế (cách nhau bằng dấu phẩy)" value={form.injuries} onChangeText={(t) => set("injuries", t)} placeholder="Ví dụ: đau lưng dưới, gối trái" />
        </Card>

        <Button full size="lg" disabled={save.isPending || !!dobError} onPress={() => save.mutate(form)}>
          {save.isPending ? "Đang lưu…" : "Lưu thay đổi"}
        </Button>
      </ScrollView>
    </View>
  );
}

function Journey({ label, value }: { label: string; value: string }) {
  return (
    <View className="w-1/2 py-1.5">
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
      <Text className="font-display text-lg text-foreground">{value}</Text>
    </View>
  );
}
