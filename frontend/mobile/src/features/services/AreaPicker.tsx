import { useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ChevronDown, ChevronUp, Globe, MapPin, Navigation, TriangleAlert } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { SelectField } from "../../components/SelectSheet";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { RADIUS_STEPS } from "./discoverySearch";
import type { SearchArea } from "./useSearchArea";

function Pill({
  label,
  icon,
  active,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${active ? "border-primary" : "border-border bg-panel"} ${disabled ? "opacity-60" : ""}`}
      style={active ? { backgroundColor: accent.primary } : undefined}
    >
      {icon}
      <Text testID={testID} className={`font-body-medium text-xs ${active ? "text-on-primary" : "text-foreground"}`}>
        {label}
      </Text>
    </Tappable>
  );
}

/**
 * "Khu vực tìm kiếm" — the one place the client says WHERE to look, shared by "Tìm PT" and "Phòng gym" (mirrors web's
 * SearchRegionBar): Toàn quốc · Dùng vị trí hiện tại · tỉnh/thành · phường/xã · bán kính 10/20/50 km.
 *
 * The GPS button is the only thing that ever asks for the location — never the screen opening. The fix is rounded and
 * kept in memory by `useSearchArea`; the card only reports it ("Đang dùng GPS") and never shows coordinates.
 */
export function AreaPicker({ area }: { area: SearchArea }) {
  const accent = useWorkspaceAccent();
  const [open, setOpen] = useState(false);
  const gpsActive = !!area.gpsCoords;
  const showRadius = area.scope === "near" && (gpsActive || !!area.wardCode);
  const locating = area.gpsStatus === "locating";

  return (
    <View testID="search-area" className="mx-5 mt-3 gap-3 rounded-2xl border border-border bg-card p-3.5">
      <Tappable
        onPress={() => setOpen((v) => !v)}
        accessibilityLabel="Khu vực tìm kiếm"
        className="flex-row items-center gap-2"
      >
        <MapPin size={16} color={accent.primary} />
        <View className="flex-1">
          <Text className="font-body-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
            Khu vực tìm kiếm
          </Text>
          <Text testID="search-area-summary" className="font-body-medium text-sm text-foreground" numberOfLines={1}>
            {area.summary}
          </Text>
        </View>
        {area.saving ? <ActivityIndicator size="small" color={accent.primary} /> : null}
        {open ? (
          <ChevronUp size={18} color={designTokens.mutedForeground} />
        ) : (
          <ChevronDown size={18} color={designTokens.mutedForeground} />
        )}
      </Tappable>

      <View className="flex-row flex-wrap gap-2">
        <Pill
          label="Toàn quốc"
          active={area.national && !gpsActive}
          icon={<Globe size={13} color={area.national && !gpsActive ? designTokens.onPrimary : designTokens.mutedForeground} />}
          onPress={area.selectNational}
        />
        {gpsActive ? (
          <Pill
            label="Đang dùng GPS"
            active
            icon={<Navigation size={13} color={designTokens.onPrimary} />}
            onPress={area.clearGps}
          />
        ) : (
          <Pill
            label={locating ? "Đang lấy vị trí…" : "Dùng vị trí hiện tại"}
            disabled={locating}
            icon={
              locating ? (
                <ActivityIndicator size="small" color={accent.primary} />
              ) : (
                <Navigation size={13} color={designTokens.mutedForeground} />
              )
            }
            onPress={() => void area.requestGps()}
          />
        )}
      </View>

      {open ? (
        <View className="gap-3">
          <SelectField
            label="Tỉnh / Thành phố"
            placeholder="Toàn quốc"
            value={area.provinceCode != null ? String(area.provinceCode) : ""}
            options={area.provinces.map((p) => ({ value: String(p.code), label: p.name }))}
            loading={area.provinces.length === 0}
            allowClear
            onChange={(v) => area.selectProvince(v ? Number(v) : null)}
          />
          <SelectField
            label="Phường / Xã"
            placeholder={area.provinceCode ? "Tất cả phường/xã" : "Chọn tỉnh trước"}
            value={area.wardCode != null ? String(area.wardCode) : ""}
            options={area.wards.map((w) => ({ value: String(w.code), label: w.name }))}
            loading={area.wardsLoading}
            disabled={!area.provinceCode || area.wards.length === 0}
            allowClear
            onChange={(v) => area.selectWard(v ? Number(v) : null)}
          />
        </View>
      ) : null}

      {showRadius ? (
        <View className="gap-1.5">
          <Text className="font-body-medium text-xs text-muted-foreground">Bán kính tìm kiếm</Text>
          <View className="flex-row flex-wrap gap-2">
            {RADIUS_STEPS.map((km) => (
              <Pill key={km} label={`${km} km`} active={area.radiusKm === km} onPress={() => area.setRadiusKm(km)} />
            ))}
          </View>
        </View>
      ) : null}

      {area.gpsProblem ? (
        <View testID="gps-problem" className="flex-row items-start gap-2 rounded-xl border border-border bg-panel p-3">
          <TriangleAlert size={16} color={designTokens.warning} />
          <View className="flex-1 gap-1.5">
            <Text className="font-body text-xs text-muted-foreground">{area.gpsProblem}</Text>
            {area.gpsStatus !== "outside" ? (
              <Tappable onPress={() => void area.requestGps()} accessibilityLabel="Thử lại vị trí" className="self-start">
                <Text className="font-body-semibold text-xs" style={{ color: accent.primary }}>
                  Thử lại vị trí
                </Text>
              </Tappable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
