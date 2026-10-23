import { useState } from "react";
import { ImageBrokenIcon } from "@phosphor-icons/react";
import { API_URL } from "../../services/api";
import { resolveListingMediaUrl } from "../../utils/listingMedia";
import { cn } from "../ui/utils";

/**
 * A listing photo. Gateway-relative "/media/..." URLs get the API base; presigned links (STAGED photos, which expire
 * after 15 minutes) are used as they are. A link that no longer loads shows a calm placeholder instead of a broken icon.
 */
export function ListingImage({ url, alt, className }: { url: string | null | undefined; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = resolveListingMediaUrl(url, API_URL);
  if (!src || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-zinc-800 text-zinc-600", className)} role="img" aria-label={alt}>
        <ImageBrokenIcon className="size-6" />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn("object-cover bg-zinc-800", className)} />;
}
