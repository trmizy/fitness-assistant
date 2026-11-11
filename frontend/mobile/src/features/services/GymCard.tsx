import { Text, View } from "react-native";
import { Image } from "expo-image";
import { Building2, ChevronRight, MapPin, Navigation } from "lucide-react-native";

import { Badge, Card, Tappable } from "../../components/ui";
import { absolutePhotoUrl } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { AmenityIcon } from "../gymListing/AmenityIcon";
import { amenityChips, gymBlockedReason, type GymRow } from "./gymDirectory";

/**
 * One branch in the gym directory: cover photo (the published cover, `coverPhotoUrl`), up to four amenity chips with their icons
 * (+N for the rest), the cheapest plan and why it cannot be bought, if it cannot. Moved out of the services screen so it can be tested.
 *
 * U2: `distanceText` is the already-worded distance badge ("~x km (đường chim bay)" / "~x km từ trung tâm <phường>") from
 * `formatGymDistanceBadge`, absent when the search gave none; `showBrand` adds the brand line (the search list is flat,
 * not grouped under brand headings). A branch with no cover photo gets a neutral building tile instead of a blank card.
 */
export function GymCard({
  gym,
  onPress,
  distanceText,
  showBrand,
}: {
  gym: GymRow;
  onPress: () => void;
  distanceText?: string | null;
  showBrand?: boolean;
}) {
  const accent = useWorkspaceAccent();
  const closed = gymBlockedReason(gym);
  const cover = absolutePhotoUrl(gym.coverPhotoUrl);
  const chips = amenityChips(gym, 4);
  return (
    <Tappable onPress={onPress}>
      <Card className="gap-2 overflow-hidden p-4">
        {cover ? (
          <Image
            source={{ uri: cover }}
            contentFit="cover"
            style={{ height: 128, borderRadius: 12 }}
            accessibilityLabel={`Ảnh ${gym.name}`}
          />
        ) : null}
        <View className="flex-row items-start justify-between gap-3">
          {!cover ? (
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
              <Building2 size={20} color={accent.primary} />
            </View>
          ) : null}
          <View className="flex-1">
            <Text className="font-display text-base text-foreground" numberOfLines={1}>
              {gym.name}
            </Text>
            {showBrand && gym.brandName ? (
              <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={1}>
                {gym.brandName}
              </Text>
            ) : null}
            {gym.city || gym.address ? (
              <View className="mt-0.5 flex-row items-center gap-1">
                <MapPin size={12} color="#8b9299" />
                <Text className="flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
                  {[gym.address, gym.city].filter(Boolean).join(", ")}
                </Text>
              </View>
            ) : null}
          </View>
          {gym.rating != null ? <Badge tone="warning">{`★ ${gym.rating.toFixed(1)}`}</Badge> : null}
        </View>

        {distanceText ? (
          <View testID="gym-distance-badge" className="flex-row items-center gap-1 self-start rounded-full border border-border bg-panel px-2 py-1">
            <Navigation size={11} color={accent.primary} />
            <Text className="font-body-medium text-[11px] text-foreground">{distanceText}</Text>
          </View>
        ) : null}

        {chips.shown.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5">
            {chips.shown.map((a) => (
              <View key={a.slug} className="flex-row items-center gap-1 rounded-full border border-border bg-panel px-2 py-1">
                <AmenityIcon iconKey={a.iconKey} size={11} />
                <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={1}>
                  {a.name}
                </Text>
              </View>
            ))}
            {chips.more > 0 ? (
              <View className="rounded-full border border-border bg-panel px-2 py-1">
                <Text className="font-body text-[11px] text-muted-foreground">{`+${chips.more}`}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View className="flex-row items-center justify-between">
          {/* Only a real price is accented — "no plans yet" in the same green would read as one. */}
          <Text
            className="font-body-medium text-sm"
            style={{ color: gym.fromPrice != null ? accent.primary : "#8b9299" }}
          >
            {gym.fromPrice != null ? `Từ ${formatVND(gym.fromPrice)}` : "Chưa mở bán gói"}
          </Text>
          <View className="flex-row items-center gap-1">
            <Text className="font-body text-sm text-muted-foreground">Xem gói</Text>
            <ChevronRight size={16} color="#8b9299" />
          </View>
        </View>

        {closed ? <Badge tone="danger">{closed}</Badge> : null}
      </Card>
    </Tappable>
  );
}
