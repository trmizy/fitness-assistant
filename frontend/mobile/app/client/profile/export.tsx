import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Download, FileJson, FileSpreadsheet, ShieldCheck, type LucideIcon } from "lucide-react-native";

import { Button, Card, ScreenHeader, Stagger, StaggerItem, useToast } from "../../../src/components/ui";
import { exportService, shareDownloadedFile } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";

type Kind = "json" | "csv";

const OPTIONS: { id: Kind; icon: LucideIcon; title: string; desc: string; mime: string }[] = [
  { id: "json", icon: FileJson, title: "Xuất JSON — Toàn bộ dữ liệu", desc: "Lịch sử tập luyện và số đo cơ thể.", mime: "application/json" },
  { id: "csv", icon: FileSpreadsheet, title: "Xuất CSV — Lịch sử tập", desc: "Mỗi dòng một set của từng buổi tập.", mime: "text/csv" },
];

/**
 * SH-09 — "Xuất dữ liệu" (the design's ExportData; web's ExportDataPage). Read-only: the file is
 * fetched from fitness-service (`/exports/json`, `/exports/csv`), written to the app's cache and
 * handed to the OS share sheet — the phone's stand-in for web's browser download (ADAPTERS §2).
 * The design's "estimated size" line is not shown: the server does not say until it sends the file.
 */
export default function ExportDataScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const [busy, setBusy] = useState<Kind | null>(null);

  const run = async (o: (typeof OPTIONS)[number]) => {
    if (busy) return;
    setBusy(o.id);
    try {
      const { uri } = o.id === "json" ? await exportService.downloadJson() : await exportService.downloadCsv();
      await shareDownloadedFile(uri, o.mime);
    } catch (e: any) {
      toast.show(e?.response?.data?.error?.message ?? e?.response?.data?.error ?? "Không thể xuất dữ liệu.", "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Xuất dữ liệu" onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/profile"))} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
        <Stagger className="gap-4">
          <StaggerItem>
            <Text className="px-1 font-body text-sm text-muted-foreground">
              Tải bản sao dữ liệu của bạn để sao lưu hoặc chuyển sang ứng dụng khác — chỉ đọc, không thay đổi dữ liệu hiện có.
            </Text>
          </StaggerItem>
          {OPTIONS.map((o) => (
            <StaggerItem key={o.id}>
              <Card className="p-4">
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                    <o.icon size={19} color={accent.primary} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-body-semibold text-sm text-foreground">{o.title}</Text>
                    <Text className="mt-0.5 font-body text-xs text-muted-foreground">{o.desc}</Text>
                  </View>
                </View>
                <Button full variant="secondary" icon={Download} className="mt-4" disabled={busy !== null} onPress={() => void run(o)}>
                  {busy === o.id ? "Đang chuẩn bị…" : "Tải xuống"}
                </Button>
              </Card>
            </StaggerItem>
          ))}
          <StaggerItem>
            <View className="flex-row items-start gap-2 px-1 pt-1">
              <ShieldCheck size={15} color={designTokens.mutedForeground} />
              <Text className="flex-1 font-body text-xs text-muted-foreground">
                Quyền riêng tư: file chỉ được lưu trên thiết bị của bạn và nơi bạn chọn chia sẻ.
              </Text>
            </View>
          </StaggerItem>
        </Stagger>
      </ScrollView>
    </View>
  );
}
