import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { ServerCog } from "lucide-react-native";

import { Button, Input, ScreenHeader, useToast } from "../../src/components/ui";
import {
  apiBaseUrl,
  clearServerOverride,
  getServerOverride,
  setServerOverride,
} from "../../src/config/serverUrl";
import { useWorkspaceAccent } from "../../src/theme/workspace";

/**
 * The hidden "Cấu hình máy chủ" screen from doc 08 §4.1 — reachable only from the small link under
 * the login form, because normal users never need it.
 *
 * It earns its place on a real device: the built-in default (`10.0.2.2`) is the Android emulator's
 * alias for the host machine and means nothing on a phone, which needs the host's LAN address or a
 * tunnel URL instead.
 *
 * Unlike web, saving does NOT reload the app — it cannot. `setServerOverride` re-points the live
 * axios instances through `onServerUrlChange` (see src/config/serverUrl.ts §17.4), so the next
 * request already uses the new address.
 */
export default function ServerConfigScreen() {
  const toast = useToast();
  const accent = useWorkspaceAccent();

  const [value, setValue] = useState(getServerOverride());
  const [current, setCurrent] = useState(apiBaseUrl());
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const trimmed = value.trim();
      if (trimmed) {
        await setServerOverride(trimmed);
        toast.show("Đã lưu địa chỉ máy chủ");
      } else {
        await clearServerOverride();
        toast.show("Đã xoá override, quay về địa chỉ mặc định");
      }
      setCurrent(apiBaseUrl());
      setValue(getServerOverride());
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Cấu hình máy chủ" onBack={() => router.back()} />

      <ScrollView contentContainerClassName="p-6 gap-6" keyboardShouldPersistTaps="handled">
        <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <ServerCog size={26} color={accent.primary} />
        </View>

        <View className="rounded-2xl border border-border bg-card p-4">
          <Text className="text-xs font-body-medium uppercase text-muted-foreground">
            Đang dùng
          </Text>
          <Text className="mt-1 font-body-semibold text-foreground">{current}</Text>
        </View>

        <View>
          <Input
            label="Địa chỉ máy chủ"
            placeholder="https://vi-du.trycloudflare.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={value}
            onChangeText={setValue}
            editable={!saving}
          />
          <Text className="mt-2 text-xs font-body leading-5 text-muted-foreground">
            Dán địa chỉ LAN hoặc đường hầm rồi bấm Lưu. Để trống rồi Lưu để quay về địa chỉ mặc
            định của bản build. Không cần khởi động lại app.
          </Text>
        </View>

        <Button full size="lg" disabled={saving} onPress={save}>
          {saving ? "Đang lưu..." : "Lưu"}
        </Button>
      </ScrollView>
    </View>
  );
}
