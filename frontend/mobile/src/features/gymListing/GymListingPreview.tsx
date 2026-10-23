import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { ImageOff, MapPin } from "lucide-react-native";

import { Badge, Button } from "../../components/ui";
import { absolutePhotoUrl } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { AmenityBadgeGroups } from "./AmenityWidgets";
import type { GymPreviewView } from "./gymListing";

/**
 * "Xem trước" — what clients would see once the open revision is approved. The server builds it
 * (GET /owner/gyms/:id/listing/preview); this only draws it. Photo links of unpublished photos are short-lived
 * presigned URLs, so a photo that fails to load asks the screen to re-read the preview.
 */
export function GymListingPreviewPanel({
  loading,
  error,
  preview,
  onRetry,
  onImageError,
}: {
  loading: boolean;
  error: string | null;
  preview: GymPreviewView | null;
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

  return (
    <ScrollView className="max-h-[520px]" showsVerticalScrollIndicator={false}>
      <View className="gap-4 pb-2">
        <Text className="font-body text-xs text-muted-foreground">
          Đây là cách khách sẽ thấy chi nhánh sau khi bản sửa được duyệt. Chỉ mình bạn xem được bản này.
        </Text>

        {preview.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {preview.photos.map((ph, i) => (
              <View key={ph.id} className="h-32 w-44 overflow-hidden rounded-xl border border-border bg-panel">
                {ph.url ? (
                  <Image
                    source={{ uri: absolutePhotoUrl(ph.url) ?? undefined }}
                    contentFit="cover"
                    style={{ flex: 1 }}
                    onError={onImageError}
                    accessibilityLabel={`Ảnh xem trước ${i + 1}`}
                  />
                ) : null}
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
            <Text className="font-body text-xs text-muted-foreground">Chưa có ảnh nào.</Text>
          </View>
        )}

        <View className="gap-1.5">
          <Text className="font-display text-lg text-foreground">{preview.name}</Text>
          {preview.address ? (
            <View className="flex-row items-center gap-1">
              <MapPin size={12} color={designTokens.mutedForeground} />
              <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">{[preview.address, preview.city].filter(Boolean).join(", ")}</Text>
            </View>
          ) : null}
        </View>

        {preview.description ? <Text className="font-body text-sm leading-6 text-foreground">{preview.description}</Text> : null}

        <View className="gap-2">
          <Text className="font-body-semibold text-xs uppercase tracking-wider text-muted-foreground">Tiện ích</Text>
          {preview.amenities.length === 0 && preview.pendingAmenities.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Chưa chọn tiện ích nào.</Text>
          ) : (
            <AmenityBadgeGroups amenities={preview.amenities.filter((a) => !a.disabled)} />
          )}
          {preview.pendingAmenities.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-1.5">
              {preview.pendingAmenities.map((p) => (
                <Badge key={p.proposalId} tone="info">{`${p.name} · chờ duyệt`}</Badge>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
