import { StarIcon as Star } from "@phosphor-icons/react";

/** Read-only average-rating stars (supports halves via fill width). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, value - i)); // 0..1 for this star
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star weight="fill" className="absolute inset-0 text-zinc-700" style={{ width: size, height: size }} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star weight="fill" className="text-amber-400 fill-amber-400" style={{ width: size, height: size }} />
            </span>
          </span>
        );
      })}
    </span>
  );
}
