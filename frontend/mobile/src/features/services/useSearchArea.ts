import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";

import { useApp } from "../../context/AppContext";
import { locationService, profileService } from "../../services/api";
import { useToast } from "../../components/ui";
import {
  DEFAULT_RADIUS_KM,
  gpsProblemText,
  ptDiscoveryKeys,
  readGpsOnce,
  regionPayload,
  regionSummaryText,
  resolveEffectiveScope,
  type Coords,
  type GpsStatus,
} from "./discoverySearch";

export type RegionItem = { code: number; name: string };

type Choice = { national: boolean; provinceCode: number | null; wardCode: number | null };
type Store = {
  /** The account this state belongs to — a different account starts from scratch (never inherits a place or a GPS fix). */
  uid: string | null;
  /** What the user picked in THIS session; null until they pick, so the saved profile area is the starting point. */
  choice: Choice | null;
  radiusKm: number;
  /** In-memory only: never written to the profile, a store, a URL or a log. */
  gpsCoords: Coords | null;
  gpsStatus: GpsStatus;
};

const initialStore = (uid: string | null): Store => ({
  uid,
  choice: null,
  radiusKm: DEFAULT_RADIUS_KM,
  gpsCoords: null,
  gpsStatus: "idle",
});

type ProfileRegion = { searchProvinceCode?: number | null; searchWardCode?: number | null } | null;

/**
 * The "Khu vực tìm kiếm" state shared by the PT and gym tabs (plan v2.2.5 / U2):
 *  - the saved area (`searchProvinceCode` / `searchWardCode`) is read from `GET /profile/me` and written back with
 *    `PUT /profile/me` — area CODES only;
 *  - a GPS fix is read only when `requestGps` runs (the "Dùng vị trí hiện tại" button), kept in memory, and dropped
 *    on any other choice, on "Toàn quốc", and on account change;
 *  - `ready` is false until the saved area has been read for a signed-in user, so the first search already uses it
 *    instead of firing a national search and then a second one.
 */
export function useSearchArea() {
  const { user, isAuthenticated } = useApp();
  const uid = isAuthenticated ? (user?.id ?? null) : null;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [stored, setStore] = useState<Store>(() => initialStore(uid));
  // Another account (or a logout) must never see the previous one's area or GPS fix, even for a frame.
  const store = stored.uid === uid ? stored : initialStore(uid);
  if (stored.uid !== uid) setStore(store);

  const regionKey = ptDiscoveryKeys(uid).profileRegion();
  const profileQuery = useQuery<ProfileRegion>({
    queryKey: regionKey,
    queryFn: async () => (await profileService.getProfile())?.profile ?? null,
    enabled: !!uid,
    staleTime: 60_000,
  });

  const saved: Choice = useMemo(() => {
    const p = profileQuery.data;
    const province = typeof p?.searchProvinceCode === "number" ? p.searchProvinceCode : null;
    const ward = province && typeof p?.searchWardCode === "number" ? p.searchWardCode : null;
    return { national: !province, provinceCode: province, wardCode: ward };
  }, [profileQuery.data]);
  const choice = store.choice ?? saved;

  const provincesQuery = useQuery<RegionItem[]>({
    queryKey: ["locations", "provinces"],
    queryFn: () => locationService.getProvinces(),
    staleTime: Infinity,
  });
  const wardsQuery = useQuery<RegionItem[]>({
    queryKey: ["locations", "wards", choice.provinceCode],
    queryFn: () => locationService.getWards(choice.provinceCode as number),
    staleTime: Infinity,
    enabled: choice.provinceCode != null,
  });
  const provinces = provincesQuery.data ?? [];
  const wards = choice.provinceCode != null ? (wardsQuery.data ?? []) : [];

  const saveMutation = useMutation({
    mutationFn: (next: { provinceCode: number | null; wardCode: number | null }) =>
      profileService.updateProfile(regionPayload(next)),
    onSuccess: (res: any, next) => {
      const body = regionPayload(next);
      queryClient.setQueryData(regionKey, (prev: any) => ({ ...(prev ?? {}), ...(res?.profile ?? {}), ...body }));
    },
    onError: () => toast.show("Không thể lưu khu vực tìm kiếm", "danger"),
  });

  const update = useCallback(
    // A slow GPS fix that lands after an account switch is dropped, not applied to the new account.
    (patch: Partial<Omit<Store, "uid">>) => setStore((s) => (s.uid === uid ? { ...s, ...patch } : s)),
    [uid],
  );
  const save = (next: { provinceCode: number | null; wardCode: number | null }) => {
    if (uid) saveMutation.mutate(next);
  };

  const selectNational = () => {
    update({ choice: { national: true, provinceCode: null, wardCode: null }, gpsCoords: null, gpsStatus: "idle" });
    save({ provinceCode: null, wardCode: null });
  };
  const selectProvince = (code: number | null) => {
    if (!code) return selectNational();
    update({ choice: { national: false, provinceCode: code, wardCode: null }, gpsCoords: null, gpsStatus: "idle" });
    save({ provinceCode: code, wardCode: null });
  };
  const selectWard = (code: number | null) => {
    if (!choice.provinceCode) return;
    update({ choice: { national: false, provinceCode: choice.provinceCode, wardCode: code }, gpsCoords: null, gpsStatus: "idle" });
    save({ provinceCode: choice.provinceCode, wardCode: code });
  };

  /** Called only from the "Dùng vị trí hiện tại" button — never on screen open. */
  const requestGps = async () => {
    update({ gpsStatus: "locating" });
    const reading = await readGpsOnce({
      requestPermission: async () => (await Location.requestForegroundPermissionsAsync()).status === "granted",
      getPosition: async () => {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return { latitude: p.coords.latitude, longitude: p.coords.longitude };
      },
    });
    if (reading.status === "granted") {
      update({ gpsCoords: reading.coords, gpsStatus: "granted", choice: { ...choice, national: false } });
    } else {
      update({ gpsCoords: null, gpsStatus: reading.status });
    }
  };
  const clearGps = () => {
    update({
      gpsCoords: null,
      gpsStatus: "idle",
      choice: { ...choice, national: !choice.provinceCode },
    });
  };
  const setRadiusKm = (km: number) => update({ radiusKm: km });

  const provinceName = provinces.find((p) => p.code === choice.provinceCode)?.name ?? null;
  const wardName = wards.find((w) => w.code === choice.wardCode)?.name ?? null;
  const scope = resolveEffectiveScope({
    national: choice.national,
    hasGps: !!store.gpsCoords,
    provinceCode: choice.provinceCode,
    wardCode: choice.wardCode,
  });

  return {
    uid,
    ready: !uid || store.choice != null || !profileQuery.isLoading,
    national: choice.national,
    provinceCode: choice.provinceCode,
    wardCode: choice.wardCode,
    radiusKm: store.radiusKm,
    gpsCoords: store.gpsCoords,
    gpsStatus: store.gpsStatus,
    gpsProblem: gpsProblemText(store.gpsStatus),
    provinces,
    wards,
    wardsLoading: wardsQuery.isLoading,
    provinceName,
    wardName,
    scope,
    summary: regionSummaryText({
      national: choice.national,
      gpsActive: !!store.gpsCoords,
      radiusKm: store.radiusKm,
      provinceName,
      wardName,
    }),
    saving: saveMutation.isPending,
    selectNational,
    selectProvince,
    selectWard,
    requestGps,
    clearGps,
    setRadiusKm,
  };
}

export type SearchArea = ReturnType<typeof useSearchArea>;
