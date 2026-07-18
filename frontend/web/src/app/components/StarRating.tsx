import { Star } from "lucide-react";

export function StarRating({
  value,
  onChange,
  size = 18,
  readonly = false,
}: {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  readonly?: boolean;
}) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="inline-flex items-center gap-0.5">
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(n)}
          className={readonly ? "cursor-default" : "cursor-pointer"}
          aria-label={`${n} sao`}
        >
          <Star
            width={size}
            height={size}
            className={
              n <= Math.round(value)
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-zinc-600"
            }
          />
        </button>
      ))}
    </div>
  );
}
