/**
 * Party upload of a REAL evidence file (S2.8). Shown only when the server lists `addEvidenceFile` (flag + case state + party).
 * The server stores the bytes, computes the sha256 itself and reads the type from the content; the description stays the party's own words.
 * One Idempotency-Key per chosen file + text (useIdempotentAction), so a double click or a retry stores the file once.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { disputeCaseApi, type EvidenceFileCreated } from "../admin/disputes/disputeCaseApi";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import { useIdempotentAction } from "../admin/disputes/useIdempotentAction";
import {
  EVIDENCE_FILE_ACCEPT,
  downloadName,
  saveBlob,
  EVIDENCE_FILE_RULE,
  formatBytes,
  validateEvidenceFile,
  validateEvidenceFileText,
} from "../admin/disputes/evidenceFileModel";
import { FOCUS, Field, MUTED, Notice, PRIMARY_BUTTON, Panel, controlClass, describedBy } from "./PartyParts";

export const EVIDENCE_FILE_SUCCESS = "Đã gửi tệp. Máy chủ đã lưu tệp và tự tính mã băm của chính tệp này; nội dung mô tả vẫn là lời của bạn.";

export function PartyEvidenceFileForm({ caseId, onSaved }: { caseId: string; onSaved: () => void }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [textErrors, setTextErrors] = useState<{ description?: string; title?: string }>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const action = useIdempotentAction<{ description: string; title: string; name: string; size: number }, EvidenceFileCreated>();

  const pick = (f: File | null) => {
    action.reset();
    setSuccess(null);
    setFeedback(null);
    setFile(f);
    if (!f) {
      setFileError(null);
      return;
    }
    const v = validateEvidenceFile(f);
    setFileError(v.ok ? null : v.error);
  };

  const clear = () => {
    setFile(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;
    const fv = validateEvidenceFile(file);
    const tv = validateEvidenceFileText(description, title);
    setFileError(fv.ok ? null : fv.error);
    setTextErrors(tv);
    if (!fv.ok || tv.description || tv.title || !file) return;
    setFeedback(null);
    const body = { description: description.trim(), title: title.trim(), name: file.name, size: file.size };
    const res = await action.run(body, (key, b) =>
      disputeCaseApi.uploadEvidenceFile(caseId, { file, fileName: b.name, description: b.description, title: b.title || undefined }, key),
    );
    if (res.status === "busy") return;
    if (res.status === "ok") {
      setSuccess(EVIDENCE_FILE_SUCCESS);
      setDescription("");
      setTitle("");
      clear();
      onSaved();
    } else {
      setFeedback(parseDisputeError(res.error, { action: "write" }).message);
    }
  };

  const fileId = `${id}-file`;
  return (
    <Panel id="d4-evidence-file" title="Gửi tệp bằng chứng" testId="d4-evidence-file-form">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className={`text-xs ${MUTED}`}>
          {EVIDENCE_FILE_RULE} Tệp được tải lên và lưu trong hồ sơ; quản trị viên xử lý hồ sơ xem được tệp này.
        </p>
        {success && (
          <div role="status" data-testid="d4-evidence-file-success" className="rounded-lg border border-st-success-border bg-st-success-bg p-3 text-sm text-st-success">
            {success}
          </div>
        )}
        {feedback && (
          <Notice tone="danger" testId="d4-evidence-file-error" role="alert">
            {feedback}
          </Notice>
        )}
        <Field id={fileId} label="Tệp" required error={fileError ?? undefined}>
          <div className="flex flex-wrap items-center gap-2">
            {/* the native control prints its prompt in the browser's language; it stays focusable (sr-only) and a label draws the Vietnamese button */}
            <input
              ref={inputRef}
              id={fileId}
              type="file"
              accept={EVIDENCE_FILE_ACCEPT}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
              disabled={action.pending}
              aria-describedby={describedBy(fileId, false, !!fileError)}
              data-testid="d4-evidence-file-input"
              className="peer sr-only"
            />
            <label
              htmlFor={fileId}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-md border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 text-sm font-medium text-[var(--text-color)] hover:brightness-110 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--primary-color)] sm:min-h-9`}
            >
              Chọn tệp
            </label>
            <span className={`min-w-0 break-all text-sm ${file ? "" : MUTED}`} data-testid="d4-evidence-file-picked">
              {file ? `${file.name} · ${formatBytes(file.size)}` : "Chưa chọn tệp"}
            </span>
            {file && (
              <button type="button" onClick={clear} disabled={action.pending} className={`min-h-11 rounded-md px-2 text-sm underline sm:min-h-9 ${FOCUS}`}>
                Bỏ tệp
              </button>
            )}
          </div>
        </Field>
        <Field id={`${id}-desc`} label="Tệp này cho thấy điều gì" required error={textErrors.description} counter={`${description.trim().length}/2000`}>
          <textarea
            id={`${id}-desc`}
            rows={3}
            maxLength={2000}
            className={controlClass(!!textErrors.description)}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setTextErrors((x) => ({ ...x, description: undefined }));
            }}
            aria-describedby={describedBy(`${id}-desc`, false, !!textErrors.description)}
            data-testid="d4-evidence-file-description"
          />
        </Field>
        <Field id={`${id}-title`} label="Tiêu đề" error={textErrors.title}>
          <input
            id={`${id}-title`}
            type="text"
            maxLength={200}
            className={controlClass(!!textErrors.title)}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTextErrors((x) => ({ ...x, title: undefined }));
            }}
            data-testid="d4-evidence-file-title"
          />
        </Field>
        <button type="submit" className={PRIMARY_BUTTON} disabled={action.pending || !file || !!fileError} data-testid="d4-evidence-file-send">
          {action.pending ? "Đang gửi tệp…" : "Gửi tệp"}
        </button>
      </form>
    </Panel>
  );
}

/** Download of the party's OWN stored file (the server answers 404 for anyone else's). */
export function PartyFileDownload({ caseId, evidenceId, fileName }: { caseId: string; evidenceId: string; fileName: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await disputeCaseApi.downloadEvidenceFile(caseId, evidenceId, "party");
      saveBlob(blob, downloadName(fileName, evidenceId));
    } catch (e) {
      setError(parseDisputeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 space-y-1">
      <button type="button" onClick={() => void run()} disabled={busy} className={`min-h-11 rounded-md border border-[var(--border-color)] px-3 text-sm font-medium sm:min-h-9 ${FOCUS}`} data-testid="d4-evidence-file-download">
        {busy ? "Đang tải tệp…" : "Tải tệp đã gửi"}
      </button>
      {error && <p role="alert" className="text-xs text-st-danger">{error}</p>}
    </div>
  );
}
