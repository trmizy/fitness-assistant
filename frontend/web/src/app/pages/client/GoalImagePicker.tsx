import { useEffect, useRef, useState } from "react";
import { CheckIcon as Check, ImageSquareIcon as ImageSquare, WarningIcon as Warning } from "@phosphor-icons/react";
import "./GoalImagePicker.css";

// "Ảnh hình thể bạn hướng tới" — optional reference photo for the roadmap wizard. The photo is analysed by a vision model into three coarse,
// non-numeric attributes (muscle look, leanness look, focus muscles) that only steer the *wording* of the AI roadmap draft; they never feed any
// calorie/macro/forecast calculation. The user confirms the suggestion before it is used. Presentation + local file handling only: the
// analysis call itself stays in the wizard (onPick).

// "unusable" = the model looked and the photo does not fit; "error" = the analysis service could not be reached (not the photo's fault).
export type GoalImageStatus = "idle" | "analyzing" | "unusable" | "error";

export type GoalImageAttributes = {
  muscularity: string | null;
  relativeLeanness: string | null;
  focusMuscles: string[];
  confidence: number;
  usable: boolean;
};

const ACCEPTED = ["image/jpeg", "image/png"];
const MAX_BYTES = 4 * 1024 * 1024; // the server rejects larger files, so say so before uploading

function confidenceWord(value: number) {
  if (value >= 0.75) return "Cao";
  if (value >= 0.5) return "Vừa";
  return "Thấp";
}

export function GoalImagePicker({
  status,
  attrs,
  confirmed,
  muscularityLabel,
  leannessLabel,
  focusLabels,
  onPick,
  onConfirm,
  onClear,
}: {
  status: GoalImageStatus;
  attrs: GoalImageAttributes | null;
  confirmed: boolean;
  muscularityLabel: Record<string, string>;
  leannessLabel: Record<string, string>;
  focusLabels: Record<string, string>;
  onPick: (file: File) => void;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastFile = useRef<File | null>(null);

  // The preview is a local object URL only — released on change/unmount.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function accept(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setLocalError("Chỉ nhận ảnh JPG hoặc PNG.");
    if (file.size > MAX_BYTES) return setLocalError("Ảnh lớn hơn 4 MB. Hãy chọn ảnh nhỏ hơn.");
    setLocalError(null);
    setPreview(URL.createObjectURL(file));
    lastFile.current = file;
    onPick(file);
  }

  // Picking the very same file again fires no change event, so clear the input first ( "Chọn ảnh khác" must always work).
  function chooseAnother() {
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }

  function clear() {
    setPreview(null);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = "";
    onClear();
  }

  const hasPhoto = preview != null;
  const analysing = status === "analyzing";

  return (
    <section className="t-goalimg space-y-3" aria-labelledby="goal-image-title" data-testid="goal-image-picker">
      <div className="flex items-baseline justify-between gap-2">
        <h4 id="goal-image-title" className="text-sm font-semibold text-zinc-200">Ảnh hình thể bạn hướng tới</h4>
        <span className="text-xs text-zinc-500">Không bắt buộc</span>
      </div>

      <input
        ref={inputRef}
        id="goal-image-input"
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        onChange={(e) => accept(e.target.files?.[0])}
      />

      {!hasPhoto ? (
        <label
          htmlFor="goal-image-input"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files?.[0]); }}
          className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-green-500/50 ${
            dragging ? "border-green-500 bg-green-500/10" : "border-zinc-700 bg-zinc-900/40 hover:border-green-500/60"
          }`}
        >
          <ImageSquare className="h-8 w-8 text-green-400" weight="duotone" />
          <span className="text-sm font-semibold text-zinc-200">Chọn ảnh hoặc thả vào đây</span>
          <span className="text-xs text-zinc-500">JPG hoặc PNG, tối đa 4 MB. Ảnh người có hình thể bạn muốn hướng tới.</span>
        </label>
      ) : (
        <div className="flex gap-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-3">
          <img src={preview!} alt="Ảnh bạn đã chọn" className="h-24 w-24 flex-shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1 space-y-2">
            {analysing && (
              <div role="status" aria-live="polite" className="space-y-2">
                <p className="t-goalimg-shimmer text-sm font-semibold">Gymini đang xem ảnh của bạn</p>
                <p className="text-xs text-zinc-500">Thường mất vài giây.</p>
              </div>
            )}

            {!analysing && status === "error" && (
              <div className="space-y-2" role="alert">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-400">
                  <Warning className="h-4 w-4" weight="fill" /> Chưa phân tích được ảnh lúc này
                </p>
                <p className="text-xs text-zinc-400">Đây không phải lỗi của ảnh. Dịch vụ phân tích đang bận hoặc chưa kết nối được, bạn thử lại sau ít phút. Bạn vẫn có thể tiếp tục mà không cần ảnh.</p>
              </div>
            )}

            {!analysing && status === "unusable" && (
              <div className="space-y-2" role="alert">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-400">
                  <Warning className="h-4 w-4" weight="fill" /> Ảnh này chưa dùng được
                </p>
                <p className="text-xs text-zinc-400">Hãy chọn ảnh rõ nét, chụp một người trưởng thành, thấy được nửa người trở lên. Bạn vẫn có thể tiếp tục mà không cần ảnh.</p>
              </div>
            )}

            {!analysing && status === "idle" && attrs && (
              <div className="space-y-2">
                <p className="t-goalimg-rise text-sm font-semibold text-zinc-100" style={{ ["--i" as string]: 0 }}>Gymini thấy ở ảnh này</p>
                <dl className="space-y-1 text-sm">
                  {[
                    ["Mức cơ bắp", attrs.muscularity ? muscularityLabel[attrs.muscularity] ?? attrs.muscularity : "Chưa rõ"],
                    ["Độ săn chắc", attrs.relativeLeanness ? leannessLabel[attrs.relativeLeanness] ?? attrs.relativeLeanness : "Chưa rõ"],
                    ...(attrs.focusMuscles.length > 0 ? [["Nhóm cơ nổi bật", attrs.focusMuscles.map((m) => focusLabels[m] ?? m).join(", ")]] : []),
                    ["Độ chắc chắn", confidenceWord(attrs.confidence)],
                  ].map(([label, value], i) => (
                    <div key={label} className="t-goalimg-rise flex flex-wrap justify-between gap-x-3" style={{ ["--i" as string]: i + 1 }}>
                      <dt className="text-zinc-500">{label}</dt>
                      <dd className="font-semibold text-zinc-200">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}

      {localError && <p role="alert" className="text-xs text-amber-400">{localError}</p>}

      {hasPhoto && !analysing && status === "idle" && attrs && !confirmed && (
        <div className="space-y-2 rounded-xl border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-sm text-zinc-200">Đây có đúng kiểu hình thể bạn muốn hướng tới không?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onConfirm} data-testid="goal-image-confirm" className="min-h-11 rounded-lg bg-green-500 px-4 text-sm font-bold text-black transition-colors hover:bg-green-400">
              Đúng, dùng gợi ý này
            </button>
            <button type="button" onClick={chooseAnother} className="min-h-11 rounded-lg border border-zinc-600 px-4 text-sm font-semibold text-zinc-300 transition-colors hover:border-green-500/50">
              Chọn ảnh khác
            </button>
            <button type="button" onClick={clear} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-zinc-400 transition-colors hover:text-red-300">
              Bỏ ảnh
            </button>
          </div>
        </div>
      )}

      {hasPhoto && confirmed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-500/30 bg-green-500/5 p-3" data-testid="goal-image-confirmed">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-green-300">
            <Check className="h-4 w-4" weight="bold" /> Đã dùng làm gợi ý cho lộ trình
          </p>
          <button type="button" onClick={clear} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-zinc-400 transition-colors hover:text-red-300">
            Bỏ ảnh
          </button>
        </div>
      )}

      {hasPhoto && !analysing && status === "error" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="goal-image-retry" onClick={() => lastFile.current && onPick(lastFile.current)} className="min-h-11 rounded-lg bg-green-500 px-4 text-sm font-bold text-black transition-colors hover:bg-green-400">
            Thử lại
          </button>
          <button type="button" onClick={clear} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-zinc-400 transition-colors hover:text-red-300">
            Bỏ qua ảnh
          </button>
        </div>
      )}

      {hasPhoto && !analysing && status === "unusable" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={chooseAnother} className="min-h-11 rounded-lg border border-zinc-600 px-4 text-sm font-semibold text-zinc-300 transition-colors hover:border-green-500/50">
            Chọn ảnh khác
          </button>
          <button type="button" onClick={clear} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-zinc-400 transition-colors hover:text-red-300">
            Bỏ qua ảnh
          </button>
        </div>
      )}

      <p className="text-xs text-zinc-500">Chỉ là gợi ý về phong cách, không phải số đo cơ thể. Ảnh chỉ dùng để phân tích và Gymini không lưu lại.</p>
    </section>
  );
}
