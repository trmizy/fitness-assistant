import { useEffect, useState } from "react";
import { PlayIcon as Play, VideoCameraIcon as Video } from "@phosphor-icons/react";

export function exerciseMediaFrame(
  videoUrl: string | null | undefined,
  frame: 0 | 1,
) {
  if (!videoUrl) return null;
  if (
    videoUrl.includes("yuhonas/free-exercise-db") &&
    videoUrl.endsWith(".jpg")
  ) {
    return videoUrl.replace(/\/[^/]+$/, `/${frame}.jpg`);
  }
  return videoUrl;
}

export function ExerciseMediaPreview({
  videoUrl,
  title,
  className = "",
  compact = false,
}: {
  videoUrl: string | null | undefined;
  title: string;
  className?: string;
  compact?: boolean;
}) {
  const firstFrame = exerciseMediaFrame(videoUrl, 0);
  const secondFrame = exerciseMediaFrame(videoUrl, 1);
  const [showSecondFrame, setShowSecondFrame] = useState(false);
  const canAnimate = !compact && !!secondFrame && secondFrame !== firstFrame;

  useEffect(() => {
    if (!canAnimate) return;
    const timer = window.setInterval(() => {
      setShowSecondFrame((value) => !value);
    }, 900);
    return () => window.clearInterval(timer);
  }, [canAnimate]);

  if (!firstFrame) {
    return (
      <div
        className={`bg-zinc-950 border border-zinc-800/60 flex items-center justify-center ${className}`}
      >
        <Video className={compact ? "w-5 h-5 text-zinc-700" : "w-8 h-8 text-zinc-700"} />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-zinc-950 ${className}`}>
      <img src={firstFrame} alt={title} loading="lazy" className="w-full h-full object-cover" />
      {canAnimate && (
        <>
          <img
            src={secondFrame}
            alt=""
            loading="lazy"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              showSecondFrame ? "opacity-100" : "opacity-0"
            }`}
          />
          <div className="absolute right-2 bottom-2 flex gap-1">
            <span className={`h-1.5 w-5 rounded-full ${showSecondFrame ? "bg-white/35" : "bg-white"}`} />
            <span className={`h-1.5 w-5 rounded-full ${showSecondFrame ? "bg-white" : "bg-white/35"}`} />
          </div>
        </>
      )}
      <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
        <Play className="w-3 h-3" />
        {canAnimate ? "Demo" : "Media"}
      </div>
    </div>
  );
}
