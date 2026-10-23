/**
 * The ONE place that binds the 30 amenity icon keys (utils/amenityIcons.ts) to Phosphor components.
 * No JSX here so a plain `npx tsx --test` can import it and assert every key has an icon.
 */
import type { ElementType } from "react";
import {
  BabyIcon,
  BarbellIcon,
  BicycleIcon,
  CarIcon,
  CoffeeIcon,
  DropIcon,
  FireIcon,
  FlowerLotusIcon,
  FootprintsIcon,
  ForkKnifeIcon,
  HeartbeatIcon,
  LightningIcon,
  LockIcon,
  MedalIcon,
  MusicNotesIcon,
  PulseIcon,
  ScanIcon,
  ShowerIcon,
  SnowflakeIcon,
  SparkleIcon,
  StarIcon,
  StorefrontIcon,
  SunIcon,
  TShirtIcon,
  TimerIcon,
  TrophyIcon,
  UserCheckIcon,
  UsersIcon,
  WavesIcon,
  WifiHighIcon,
} from "@phosphor-icons/react";
import { AMENITY_ICON_PHOSPHOR, type AmenityIconKey } from "../../utils/amenityIcons";

/** Phosphor export name (without the `Icon` suffix, as in AMENITY_ICON_PHOSPHOR) → component. */
const PHOSPHOR_BY_NAME: Record<string, ElementType> = {
  Baby: BabyIcon,
  Barbell: BarbellIcon,
  Bicycle: BicycleIcon,
  Car: CarIcon,
  Coffee: CoffeeIcon,
  Drop: DropIcon,
  Fire: FireIcon,
  FlowerLotus: FlowerLotusIcon,
  Footprints: FootprintsIcon,
  ForkKnife: ForkKnifeIcon,
  Heartbeat: HeartbeatIcon,
  Lightning: LightningIcon,
  Lock: LockIcon,
  Medal: MedalIcon,
  MusicNotes: MusicNotesIcon,
  Pulse: PulseIcon,
  Scan: ScanIcon,
  Shower: ShowerIcon,
  Snowflake: SnowflakeIcon,
  Sparkle: SparkleIcon,
  Star: StarIcon,
  Storefront: StorefrontIcon,
  Sun: SunIcon,
  TShirt: TShirtIcon,
  Timer: TimerIcon,
  Trophy: TrophyIcon,
  UserCheck: UserCheckIcon,
  Users: UsersIcon,
  Waves: WavesIcon,
  WifiHigh: WifiHighIcon,
};

export const AMENITY_ICON_COMPONENTS = Object.fromEntries(
  (Object.keys(AMENITY_ICON_PHOSPHOR) as AmenityIconKey[]).map((key) => [key, PHOSPHOR_BY_NAME[AMENITY_ICON_PHOSPHOR[key]]]),
) as Record<AmenityIconKey, ElementType>;

/** Icon for a key; a key the web does not know (the server list grew) falls back to a neutral sparkle. */
export function amenityIconFor(key: string | null | undefined): ElementType {
  return (key && (AMENITY_ICON_COMPONENTS as Record<string, ElementType>)[key]) || SparkleIcon;
}
