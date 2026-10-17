import { ActivityIndicator, Linking, Text, View } from "react-native";
import { useIsFocused } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { CameraOff, ScanLine } from "lucide-react-native";

import { Button } from "./ui";
import { darkColors, designTokens } from "../theme/colors";
import { useWorkspaceAccent } from "../theme/workspace";

/**
 * The camera half of the gym check-in screens, shared by the member scan (app/client/services/
 * checkin.tsx) and the PT scan (app/pt/gym-checkin.tsx): permission states, the native QR scanner
 * (expo-camera — no frame decoding in JS), the aiming frame, a pending overlay, the hint line and
 * the last error. The camera only runs while the host screen is focused.
 *
 * It owns no request logic: the host decides what a scanned code means and de-duplicates the
 * scanner's many-reads-per-second (one request per scan, not per frame).
 */
export function QrScannerView({
  onScanned,
  pending,
  errorText,
  permissionText,
  hint,
}: {
  onScanned: (data: string) => void;
  pending: boolean;
  errorText: string | null;
  permissionText: string;
  hint: string;
}) {
  const accent = useWorkspaceAccent();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) {
    return (
      <View className="items-center py-16">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="items-center gap-3 px-8 py-12">
        <CameraOff size={40} color={designTokens.mutedForeground} />
        <Text className="text-center font-body text-sm text-muted-foreground">{permissionText}</Text>
        {permission.canAskAgain ? (
          <Button className="self-center" onPress={() => void requestPermission()}>Cho phép camera</Button>
        ) : (
          <Button className="self-center" variant="secondary" onPress={() => void Linking.openSettings()}>
            Mở cài đặt để cấp quyền
          </Button>
        )}
      </View>
    );
  }

  return (
    <View className="gap-3 px-5">
      <View className="aspect-square overflow-hidden rounded-3xl bg-black">
        {focused ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }: BarcodeScanningResult) => onScanned(data)}
          />
        ) : null}
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <View className="h-56 w-56 rounded-2xl border-2" style={{ borderColor: accent.primary }} />
        </View>
        {pending ? (
          <View className="absolute inset-0 items-center justify-center bg-black/60">
            <ActivityIndicator size="large" color={accent.primary} />
          </View>
        ) : null}
      </View>
      <View className="flex-row items-center justify-center gap-2">
        <ScanLine size={14} color={designTokens.mutedForeground} />
        <Text className="font-body text-xs text-muted-foreground">{hint}</Text>
      </View>
      {errorText ? (
        <Text className="text-center font-body text-sm" style={{ color: darkColors.destructive }}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
