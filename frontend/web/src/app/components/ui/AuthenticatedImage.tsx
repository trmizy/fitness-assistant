import { useEffect, useState } from "react";
import { ImageBrokenIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { cn } from "./utils";

export interface AuthenticatedImageProps {
  /** e.g. `() => gymService.fetchComplaintPhotoBlob(token)` or the `adminService` variant. */
  fetchBlob: () => Promise<Blob>;
  alt: string;
  className?: string;
  onClick?: () => void;
}

/**
 * GYM_MANAGEMENT master spec, Phase 5 — complaint evidence photos are private (never a
 * public URL an `<img src>` could point at directly), so this fetches the bytes through an
 * authenticated axios call and hands the browser an object URL instead. Revokes the object
 * URL on unmount/token change to avoid leaking blob memory across a long admin session.
 */
export function AuthenticatedImage({ fetchBlob, alt, className, onClick }: AuthenticatedImageProps) {
  const [state, setState] = useState<{ url: string | null; loading: boolean; error: boolean }>({
    url: null,
    loading: true,
    error: false,
  });

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, error: false });

    fetchBlob()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, error: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.loading) {
    return (
      <div className={cn("flex items-center justify-center bg-zinc-900 rounded-lg", className)}>
        <CircleNotchIcon className="size-5 text-zinc-600 animate-spin" />
      </div>
    );
  }
  if (state.error || !state.url) {
    return (
      <div className={cn("flex items-center justify-center bg-zinc-900 rounded-lg text-zinc-600", className)}>
        <ImageBrokenIcon className="size-5" />
      </div>
    );
  }
  return <img src={state.url} alt={alt} onClick={onClick} className={cn("object-cover rounded-lg", onClick && "cursor-pointer", className)} />;
}
