import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { ImageOff } from "lucide-react-native";

import { Badge, Button, Card } from "../../components/ui";
import { absolutePhotoUrl } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { GOAL_OPTIONS, TARGET_OPTIONS } from "../ptApplication/ptApplication";
import { perSessionPrice } from "../pt/pt";
import type { PreviewView } from "./ptListing";

const labelOf = (options: { value: string; label: string }[], v: string) => options.find((o) => o.value === v)?.label ?? v;

/**
 * "Xem trước" — what clients would see once the open revision is approved. The server builds it
 * (GET /profile/me/listing/preview); this only draws it. Photo links of unpublished photos are
 * short-lived presigned URLs, so a photo that fails to load asks the screen to re-read the preview.
 */
export function ListingPreviewPanel({
  loading,
  error,
  preview,
  onRetry,
  onImageError,
}: {
  loading: boolean;
  error: string | null;
  preview: PreviewView | null;
  onRetry: () => void;
  onImageError: () => void;
}) {
  const accent = useWorkspaceAccent();

  if (loading) {
    return (
      <View className="items-center py-10">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }
  if (error || !preview) {
    return (
      <View className="items-center gap-3 py-8">
        <Text className="text-center font-body text-sm text-muted-foreground">{error ?? "Chưa có bản xem trước."}</Text>
        <Button size="sm" variant="secondary" onPress={onRetry}>
          Thử lại
        </Button>
      </View>
    );
  }

  const p = preview.profile;
  return (
    <ScrollView className="max-h-[520px]" showsVerticalScrollIndicator={false}>
      <View className="gap-4 pb-2">
        <Text className="font-body text-xs text-muted-foreground">
          Đây là cách khách sẽ thấy tin đăng của bạn sau khi được duyệt. Chỉ mình bạn xem được bản này.
        </Text>

        {preview.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {preview.photos.map((ph, i) => (
              <View key={ph.id} className="h-40 w-32 overflow-hidden rounded-xl border border-border bg-panel">
                <Image
                  source={{ uri: absolutePhotoUrl(ph.url) ?? undefined }}
                  contentFit="cover"
                  style={{ flex: 1 }}
                  onError={onImageError}
                  accessibilityLabel={`Ảnh xem trước ${i + 1}`}
                />
                {ph.isCover ? (
                  <View className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5">
                    <Text className="font-body text-[10px] text-white">Ảnh bìa</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View className="flex-row items-center gap-2">
            <ImageOff size={16} color={designTokens.mutedForeground} />
            <Text className="font-body text-xs text-muted-foreground">Chưa có ảnh hình thể.</Text>
          </View>
        )}

        <View className="gap-2">
          <Text className="font-display text-lg text-foreground">{preview.name}</Text>
          {preview.specialties.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5">
              {preview.specialties.map((s) => (
                <Badge key={s} tone="neutral">
                  {s}
                </Badge>
              ))}
            </View>
          ) : null}
          {preview.fromPricePerSession != null ? (
            <Text className="font-body-semibold text-sm text-primary">
              {`Từ ${formatVND(preview.fromPricePerSession)}/buổi`}
              {preview.fromPackagePrice != null ? ` · Gói từ ${formatVND(preview.fromPackagePrice)}` : ""}
            </Text>
          ) : (
            <Text className="font-body text-xs text-muted-foreground">Chưa có gói nào đang bán nên thẻ của bạn chưa hiện giá.</Text>
          )}
        </View>

        {p.professionalBio ? <Text className="font-body text-sm leading-6 text-foreground">{p.professionalBio}</Text> : null}
        {p.trainingMethodsApproach ? (
          <View className="gap-1">
            <Text className="font-body-semibold text-xs uppercase tracking-wider text-muted-foreground">Phương pháp huấn luyện</Text>
            <Text className="font-body text-sm leading-6 text-foreground">{p.trainingMethodsApproach}</Text>
          </View>
        ) : null}
        {p.targetClientGroups.length > 0 || p.primaryTrainingGoals.length > 0 ? (
          <View className="gap-2">
            <View className="flex-row flex-wrap gap-1.5">
              {p.targetClientGroups.map((g) => (
                <Badge key={`t-${g}`} tone="info">
                  {labelOf(TARGET_OPTIONS, g)}
                </Badge>
              ))}
              {p.primaryTrainingGoals.map((g) => (
                <Badge key={`g-${g}`}>{labelOf(GOAL_OPTIONS, g)}</Badge>
              ))}
            </View>
          </View>
        ) : null}
        {p.languages.length > 0 ? <Text className="font-body text-xs text-muted-foreground">{`Ngôn ngữ: ${p.languages.join(", ")}`}</Text> : null}

        <View className="gap-2">
          <Text className="font-body-semibold text-xs uppercase tracking-wider text-muted-foreground">Gói dịch vụ</Text>
          {preview.packages.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Chưa có gói nào đang bán.</Text>
          ) : (
            preview.packages.map((pkg, i) => (
              <Card key={pkg.id ?? `new-${i}`} className="flex-row items-start justify-between gap-3 p-3">
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap items-center gap-1.5">
                    <Text className="font-body-semibold text-sm text-foreground">{pkg.name}</Text>
                    {pkg.isNew ? <Badge tone="info">Mới</Badge> : null}
                  </View>
                  <Text className="font-body text-xs text-muted-foreground">
                    {`${pkg.sessionCount} buổi · ${pkg.sessionMode === "ONLINE" ? "Online" : "Tại phòng gym"} · ${pkg.sessionDurationMinutes} phút/buổi`}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="font-display text-sm text-primary">{formatVND(pkg.price)}</Text>
                  <Text className="font-body text-[11px] text-muted-foreground">{`${formatVND(perSessionPrice(pkg))}/buổi`}</Text>
                </View>
              </Card>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
