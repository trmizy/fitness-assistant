import { Alert, Text, View } from "react-native";

import { Tappable } from "../../components/ui";
import { useWorkspaceAccent } from "../../theme/workspace";
import { PHOTO_ATTRIBUTION_LINK, PHOTO_SOURCES, photoAttributionLine } from "./discoverySearch";

/**
 * The line under a gallery of illustrative photos — "Ảnh minh hoạ · Nguồn ảnh & giấy phép" (web shows the same under a PT's
 * photos). The listing APIs expose no per-photo author, so none is invented; pass `photographer` only once one does.
 */
export function PhotoAttribution({ photographer }: { photographer?: string | null }) {
  const accent = useWorkspaceAccent();
  return (
    <View testID="photo-attribution" className="flex-row flex-wrap items-center gap-x-1">
      <Text className="font-body text-[11px] text-muted-foreground">{`${photoAttributionLine(photographer)} ·`}</Text>
      <Tappable
        onPress={() =>
          Alert.alert(
            PHOTO_ATTRIBUTION_LINK,
            PHOTO_SOURCES.map((s) => `${s.title}\n${s.detail}`).join("\n\n"),
          )
        }
        accessibilityLabel={PHOTO_ATTRIBUTION_LINK}
      >
        <Text className="font-body-medium text-[11px]" style={{ color: accent.primary }}>
          {PHOTO_ATTRIBUTION_LINK}
        </Text>
      </Tappable>
    </View>
  );
}
