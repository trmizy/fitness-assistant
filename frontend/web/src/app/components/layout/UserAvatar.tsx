import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../context/AppContext";
import { profileService } from "../../services/api";

/**
 * The signed-in user's own avatar: profile photo when they have one, initial otherwise.
 *
 * `UserProfile.photoUrl` is the single source of truth, read through the same
 * ["profile", userId] query ProfilePage uses — so changing the photo there (which invalidates
 * that key) updates every avatar built from this component, with no second copy to keep in sync.
 * Profile photo URLs are short-lived signed links, hence the modest staleTime: it keeps a
 * long-open tab from serving an expired link, while an image that fails to load falls back to
 * the initial instead of a broken icon.
 */
export function UserAvatar({
  className,
  fallbackClassName,
}: {
  /** Size/shape, applied to both the image and the initial fallback. */
  className: string;
  /** Colors/typography for the initial fallback only. */
  fallbackClassName: string;
}) {
  const { user } = useApp();
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
    staleTime: 4 * 60 * 1000,
    retry: false,
  });

  const photoUrl: string | null = profile?.photoUrl ?? null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => setFailedUrl(null), [photoUrl]);

  if (photoUrl && photoUrl !== failedUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={`${className} rounded-full object-cover flex-shrink-0`}
        onError={() => setFailedUrl(photoUrl)}
      />
    );
  }

  return (
    <div className={`${className} rounded-full flex items-center justify-center flex-shrink-0 ${fallbackClassName}`}>
      {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
    </div>
  );
}
