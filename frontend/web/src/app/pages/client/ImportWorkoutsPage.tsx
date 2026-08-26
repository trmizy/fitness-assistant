import { useState } from "react";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2, XCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import {
  importService,
  type ImportPreviewResult,
  type ImportCommitResult,
  type ImportExerciseResolution,
} from "../../services/api";

/**
 * Roadmap P2 "Canonical import framework" + P2.1 "Hevy import" + P2.2
 * "Strong import" (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md,
 * docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 *
 * Upload -> preview (parsed workouts + per-exercise match candidates) ->
 * resolve each distinct exercise name (use existing / create custom /
 * skip) -> commit. No exercise is ever auto-mapped without an explicit
 * choice, matching the same rule Custom Exercises (P1.5) already follows.
 *
 * One page, one flow for every provider — a provider selector, not a
 * second page, matching §14's own "do not build four unrelated
 * importers" instruction.
 */

const PROVIDERS = [
  { value: "hevy", label: "Hevy" },
  { value: "strong", label: "Strong" },
] as const;
type Provider = (typeof PROVIDERS)[number]["value"];

// Same enum sets exercise.service.ts validates a custom exercise against
// — hardcoded here (not fetched from /exercises/filter-options) so this
// form works correctly regardless of that endpoint's response shape.
const BODY_PARTS = ["UPPER_BODY", "LOWER_BODY", "CORE", "FULL_BODY"];
const EQUIPMENTS = ["BODYWEIGHT", "BARBELL", "DUMBBELLS", "KETTLEBELL", "MACHINE", "RESISTANCE_BAND", "CABLE", "MEDICINE_BALL", "FOAM_ROLLER"];
const ACTIVITY_TYPES = ["STRENGTH", "CARDIO", "MOBILITY", "STRENGTH_CARDIO", "STRENGTH_MOBILITY"];
const MOVEMENT_TYPES = ["PUSH", "PULL", "HOLD", "STRETCH"];
const LOGGING_MODES = ["REPS_LOAD", "BODYWEIGHT_REPS", "TIME", "TIME_LOAD", "DISTANCE_TIME"];

function labelizeEnum(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

type ResolutionChoice = "SKIP" | "CREATE_CUSTOM" | `CANDIDATE:${number}`;

export function ImportWorkoutsPage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState<Provider>("hevy");
  const [file, setFile] = useState<File | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [choices, setChoices] = useState<Record<string, ResolutionChoice>>({});
  const [customForms, setCustomForms] = useState<Record<string, { typeOfActivity: string; typeOfEquipment: string; bodyPart: string; type: string; loggingMode: string }>>({});
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [blockedCandidates, setBlockedCandidates] = useState<{ title: string; candidates: any[] } | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setChoices({});
    setCustomForms({});
    setCommitResult(null);
    setBlockedCandidates(null);
  };

  const handlePreview = async () => {
    if (!file) return;
    setIsPreviewing(true);
    try {
      const csvContent = await file.text();
      const result = provider === "hevy"
        ? await importService.previewHevy(file.name, csvContent)
        : await importService.previewStrong(file.name, csvContent);
      setPreview(result);
      if (result.blocked) {
        toast.error(result.reason || "Không thể xem trước file này.");
        return;
      }
      const initialChoices: Record<string, ResolutionChoice> = {};
      const initialForms: Record<string, any> = {};
      for (const entry of result.exerciseMatchSummary ?? []) {
        if (entry.isExactMatch) {
          initialChoices[entry.exerciseTitle] = "CANDIDATE:0";
        }
        initialForms[entry.exerciseTitle] = {
          typeOfActivity: "STRENGTH",
          typeOfEquipment: "BODYWEIGHT",
          bodyPart: "FULL_BODY",
          type: "PUSH",
          loggingMode: "REPS_LOAD",
        };
      }
      setChoices(initialChoices);
      setCustomForms(initialForms);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể xem trước file này.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const buildResolutions = (): Record<string, ImportExerciseResolution> => {
    const resolutions: Record<string, ImportExerciseResolution> = {};
    for (const entry of preview?.exerciseMatchSummary ?? []) {
      const choice = choices[entry.exerciseTitle];
      if (!choice || choice === "SKIP") {
        resolutions[entry.exerciseTitle] = { action: "SKIP" };
      } else if (choice === "CREATE_CUSTOM") {
        resolutions[entry.exerciseTitle] = { action: "CREATE_CUSTOM", input: customForms[entry.exerciseTitle] };
      } else {
        const idx = Number(choice.split(":")[1]);
        resolutions[entry.exerciseTitle] = { action: "USE_EXISTING", exerciseId: entry.candidates[idx].id };
      }
    }
    return resolutions;
  };

  const allResolved = (preview?.exerciseMatchSummary ?? []).every((e) => !!choices[e.exerciseTitle]);

  const handleCommit = async () => {
    if (!preview?.batchId) return;
    setIsCommitting(true);
    setBlockedCandidates(null);
    try {
      const result = await importService.commit(preview.batchId, buildResolutions());
      setCommitResult(result);
      toast.success(`Đã nhập ${result.committedWorkoutCount} buổi tập.`);
    } catch (error: any) {
      if (error?.response?.status === 409 && error?.response?.data?.candidates) {
        setBlockedCandidates({ title: error.response.data.error, candidates: error.response.data.candidates });
        toast.error("Một bài tập trùng với bài đã có — vui lòng chọn 'Dùng bài có sẵn' thay vì tạo mới.");
      } else {
        toast.error(error?.response?.data?.error || "Không thể xác nhận nhập dữ liệu.");
      }
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCancel = async () => {
    if (!preview?.batchId) {
      reset();
      return;
    }
    try {
      await importService.cancel(preview.batchId);
    } catch {
      // Best-effort — the batch just stays PREVIEW/unused if this fails; no data was ever written.
    }
    reset();
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <button
        type="button"
        onClick={() => navigate("/client/profile")}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại hồ sơ
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Upload className="w-5 h-5 text-sky-400" /> Nhập lịch sử tập luyện
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Nhập file export CSV từ Hevy. Bạn sẽ xem trước và xác nhận từng bài tập chưa khớp trước khi lưu.
        </p>
      </div>

      {commitResult ? (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-5 space-y-3" data-testid="import-commit-summary">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="w-5 h-5" />
            <p className="font-semibold">Nhập dữ liệu thành công</p>
          </div>
          <ul className="text-sm text-zinc-300 space-y-1">
            <li data-testid="import-committed-count">Đã lưu {commitResult.committedWorkoutCount} buổi tập mới.</li>
            {commitResult.alreadyImportedSkippedCount > 0 && (
              <li>{commitResult.alreadyImportedSkippedCount} buổi tập đã được nhập trước đó — bỏ qua, không nhập trùng.</li>
            )}
            {commitResult.skippedExerciseSetCount > 0 && (
              <li>{commitResult.skippedExerciseSetCount} set thuộc các bài tập bị bỏ qua.</li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => navigate("/client/workout")}
            className="px-4 py-2 rounded-xl bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400"
          >
            Xem lịch sử tập luyện
          </button>
        </div>
      ) : !preview ? (
        <div className="rounded-2xl border border-dashed border-zinc-700/40 bg-zinc-900/30 p-8 text-center space-y-4">
          <div className="flex justify-center gap-2" data-testid="import-provider-selector">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                data-testid={`import-provider-${p.value}`}
                onClick={() => setProvider(p.value)}
                className={`px-4 py-1.5 rounded-lg text-xs border transition-colors ${
                  provider === p.value
                    ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                    : "border-zinc-700/40 text-zinc-400 hover:bg-zinc-800/40"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="import-file-input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-sky-500/15 file:text-sky-300 file:text-xs hover:file:bg-sky-500/25"
          />
          <button
            type="button"
            data-testid="import-preview-button"
            onClick={handlePreview}
            disabled={!file || isPreviewing}
            className="px-5 py-2.5 rounded-xl bg-sky-500 text-black text-xs font-bold hover:bg-sky-400 disabled:opacity-40 inline-flex items-center gap-2"
          >
            {isPreviewing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Xem trước
          </button>
        </div>
      ) : preview.blocked ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/8 p-5 space-y-2">
          <div className="flex items-center gap-2 text-red-300">
            <XCircle className="w-5 h-5" />
            <p className="font-semibold">{preview.reason}</p>
          </div>
          <button type="button" onClick={reset} className="px-4 py-2 rounded-xl border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800">
            Thử file khác
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/40 p-4 grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="import-preview-summary">
            <div>
              <p className="text-2xl text-zinc-100 font-semibold" data-testid="import-workout-count">{preview.workoutCount}</p>
              <p className="text-[11px] text-zinc-500">Buổi tập</p>
            </div>
            <div>
              <p className="text-2xl text-zinc-100 font-semibold">{preview.dateRange?.earliest ?? "—"}</p>
              <p className="text-[11px] text-zinc-500">Từ ngày</p>
            </div>
            <div>
              <p className="text-2xl text-zinc-100 font-semibold">{preview.dateRange?.latest ?? "—"}</p>
              <p className="text-[11px] text-zinc-500">Đến ngày</p>
            </div>
            <div>
              <p className="text-2xl text-amber-300 font-semibold">{preview.alreadyImportedCount ?? 0}</p>
              <p className="text-[11px] text-zinc-500">Đã nhập trước đó</p>
            </div>
          </div>

          {preview.rowErrors.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300 space-y-1">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> {preview.rowErrors.length} dòng không đọc được — đã bỏ qua</p>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Xác nhận từng bài tập</p>
            {(preview.exerciseMatchSummary ?? []).map((entry, index) => (
              <div key={entry.exerciseTitle} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 space-y-2" data-testid={`import-resolve-row-${index}`}>
                <p className="text-sm text-zinc-200">{entry.exerciseTitle}</p>
                <select
                  data-testid={`import-resolve-select-${index}`}
                  value={choices[entry.exerciseTitle] ?? ""}
                  onChange={(e) => setChoices((prev) => ({ ...prev, [entry.exerciseTitle]: e.target.value as ResolutionChoice }))}
                  className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                >
                  <option value="" disabled>Chọn cách xử lý...</option>
                  {entry.candidates.map((c, i) => (
                    <option key={c.id} value={`CANDIDATE:${i}`}>
                      Dùng bài có sẵn: {c.name} ({Math.round(c.confidence * 100)}%)
                    </option>
                  ))}
                  <option value="CREATE_CUSTOM">Tạo bài tập mới</option>
                  <option value="SKIP">Bỏ qua bài tập này</option>
                </select>

                {choices[entry.exerciseTitle] === "CREATE_CUSTOM" && (
                  <div className="grid grid-cols-2 gap-2 pt-1" data-testid={`import-custom-form-${index}`}>
                    {([
                      ["bodyPart", "Nhóm cơ", BODY_PARTS],
                      ["typeOfEquipment", "Thiết bị", EQUIPMENTS],
                      ["typeOfActivity", "Loại hoạt động", ACTIVITY_TYPES],
                      ["type", "Kiểu chuyển động", MOVEMENT_TYPES],
                      ["loggingMode", "Cách ghi log", LOGGING_MODES],
                    ] as const).map(([field, label, options]) => (
                      <label key={field} className="block">
                        <span className="block text-[10px] text-zinc-500 mb-1">{label}</span>
                        <select
                          value={customForms[entry.exerciseTitle]?.[field] ?? options[0]}
                          onChange={(e) =>
                            setCustomForms((prev) => ({
                              ...prev,
                              [entry.exerciseTitle]: { ...prev[entry.exerciseTitle], [field]: e.target.value },
                            }))
                          }
                          className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-[11px] text-zinc-200"
                        >
                          {options.map((v) => (
                            <option key={v} value={v}>{labelizeEnum(v)}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {blockedCandidates && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-amber-200">
              {blockedCandidates.title} — {blockedCandidates.candidates.map((c: any) => c.name).join(", ")}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800"
            >
              Hủy
            </button>
            <button
              type="button"
              data-testid="import-commit-button"
              onClick={handleCommit}
              disabled={!allResolved || isCommitting}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 py-2.5 text-xs font-bold text-black"
            >
              {isCommitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Xác nhận nhập
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
