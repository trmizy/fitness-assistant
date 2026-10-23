import {
  Activity,
  Baby,
  Bike,
  Coffee,
  CupSoda,
  Droplets,
  Dumbbell,
  Flame,
  Flower,
  Footprints,
  HeartPulse,
  Lock,
  Medal,
  Music,
  ScanLine,
  Shirt,
  ShowerHead,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Timer,
  Trophy,
  UserCheck,
  Users,
  Utensils,
  Waves,
  Wifi,
  Zap,
  Car,
  type LucideIcon,
} from "lucide-react-native";

import { designTokens } from "../../theme/colors";
import { GENERIC_AMENITY_ICON, amenityIconName } from "./amenityIcons";

/**
 * The lucide component behind each export NAME in `AMENITY_ICON_LUCIDE`. Named imports (not `import *`) so the
 * bundler keeps only these icons; `AmenityIcon.test.tsx` asserts every allowlist key resolves to a component here.
 */
export const LUCIDE_BY_NAME: Record<string, LucideIcon> = {
  Dumbbell,
  HeartPulse,
  Activity,
  Users,
  Flower,
  Waves,
  UserCheck,
  ScanLine,
  Lock,
  ShowerHead,
  Flame,
  Shirt,
  Car,
  Wifi,
  Snowflake,
  Droplets,
  Baby,
  CupSoda,
  Bike,
  Coffee,
  Sparkles,
  Sun,
  Music,
  Star,
  Footprints,
  Trophy,
  Timer,
  Zap,
  Medal,
  Utensils,
};

/** The icon component for an allowlist key (the generic one for an unknown key). */
export function amenityIconComponent(key: string | null | undefined): LucideIcon {
  return LUCIDE_BY_NAME[amenityIconName(key)] ?? LUCIDE_BY_NAME[GENERIC_AMENITY_ICON];
}

/** An amenity's icon from its allowlist key. Decorative: the name always sits next to it. */
export function AmenityIcon({ iconKey, size = 14, color }: { iconKey: string | null | undefined; size?: number; color?: string }) {
  const Icon = amenityIconComponent(iconKey);
  return <Icon size={size} color={color ?? designTokens.mutedForeground} />;
}
