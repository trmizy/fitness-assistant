import { amenityIconFor } from "./amenityIconMap";

/** An amenity's icon from its allowlist key. Decorative (the name always sits next to it). */
export function AmenityIcon({ iconKey, className = "size-4" }: { iconKey: string | null | undefined; className?: string }) {
  const Icon = amenityIconFor(iconKey);
  return <Icon className={className} aria-hidden="true" />;
}
