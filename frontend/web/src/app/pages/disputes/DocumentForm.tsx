import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { disputeCaseApi } from "../admin/disputes/disputeCaseApi";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import type { CreatedId } from "../admin/disputes/disputeCaseTypes";
import { useIdempotentAction } from "../admin/disputes/useIdempotentAction";
import { Field, FOCUS, LIST_PATH, Notice, PRIMARY_BUTTON, Panel, PartyLink, ReloadButton, controlClass, describedBy } from "./PartyParts";
import { NOT_FOUND_TEXT, NO_FILE_NOTE } from "./partyLabels";
import {
  DESCRIPTION_MAX,
  FILE_NAME_MAX,
  TITLE_MAX,
  describeFormFailure,
  isSha256,
  normalizeSha256,
  validateDocument,
  type DocumentBody,
  type FieldErrors,
  type FormFeedback,
} from "./partyModel";
import { HASH_MESSAGE, sha256OfFile } from "./sha256";

type HashState = { kind: "idle" } | { kind: "computing"; name: string } | { kind: "done"; name: string } | { kind: "failed"; message: string };

/**
 * D4 / B4 - "Khai tài liệu". The server stores a DESCRIPTION and a self-declared sha256 and NO file (file upload is switched off, B5).
 * A file may be picked only to compute its sha256 in this browser with crypto.subtle; the bytes are never read into the request:
 * the body below is built from strings (`validateDocument`) and sent as JSON.
 */
export function DocumentForm({ caseId, onSaved, onReload, reloading }: { caseId: string; onSaved: () => void; onReload: () => Promise<unknown> | void; reloading: boolean }) {
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [sha, setSha] = useState("");
  const [hash, setHash] = useState<HashState>({ kind: "idle" });
  const [pickerKey, setPickerKey] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const action = useIdempotentAction<DocumentBody, CreatedId>();
  const token = useRef(0);
  const focusId = useRef<string | null>(null);
  const fileNameWasAuto = useRef(false);

  useEffect(() => {
    if (!focusId.current) return;
    document.getElementById(focusId.current)?.focus();
    focusId.current = null;
  });

  const busy = action.pending;
  const shaNorm = normalizeSha256(sha);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const mine = ++token.current;
    if (!file) {
      setHash({ kind: "idle" });
      return;
    }
    setHash({ kind: "computing", name: file.name });
    if (!fileName.trim() || fileNameWasAuto.current) {
      setFileName(file.name.slice(0, FILE_NAME_MAX));
      fileNameWasAuto.current = true;
    }
    const result = await sha256OfFile(file);
    if (mine !== token.current) return; // a newer pick or "Bỏ tệp" superseded this one
    if (result.status === "ok") {
      setSha(result.hex);
      setErrors((x) => ({ ...x, sha256: undefined }));
      setHash({ kind: "done", name: file.name });
    } else {
      setHash({ kind: "failed", message: HASH_MESSAGE[result.status] });
    }
  };

  const clearPick = () => {
    token.current++;
    setHash({ kind: "idle" });
    setPickerKey((k) => k + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending || mustReload) return;
    const checked = validateDocument({ description, title, fileName, sha256: sha });
    if ("errors" in checked) {
      setErrors(checked.errors);
      setFeedback(null);
      setSaved(null);
      const first = (["description", "title", "fileName", "sha256"] as const).find((k) => checked.errors[k]);
      focusId.current = first ? `d4-doc-${first}` : null;
      return;
    }
    setErrors({});
    setFeedback(null);
    setSaved(null);
    const out = await action.run(checked.body, (key, body) => disputeCaseApi.submitEvidence(caseId, body, key));
    if (out.status === "busy") return;
    if (out.status === "ok") {
      setDescription("");
      setTitle("");
      setFileName("");
      setSha("");
      fileNameWasAuto.current = false;
      clearPick();
      setSaved("Đã ghi tài liệu bạn khai vào hồ sơ. Không có tệp nào được tải lên; đây là lời khai của bạn, chưa được xác minh.");
      onSaved();
      return;
    }
    const f = describeFormFailure(parseDisputeError(out.error, { action: "write" }));
    setFeedback(f);
    setErrors(f.fieldErrors);
    const first = (["description", "title", "fileName", "sha256"] as const).find((k) => f.fieldErrors[k]);
    if (first) focusId.current = `d4-doc-${first}`;
    if (f.mustReload) setMustReload(true);
  };

  const reload = async () => {
    await onReload();
    setMustReload(false);
    setFeedback(null);
  };

  const shaLen = shaNorm.length;
  return (
    <Panel id="d4-doc" title="Khai tài liệu" testId="d4-document-form">
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy || undefined}>
        <Notice tone="info" testId="d4-no-file-note">
          {NO_FILE_NOTE}
        </Notice>

        <Field id="d4-doc-description" label="Mô tả tài liệu" required error={errors.description} counter={`${description.trim().length}/${DESCRIPTION_MAX}`}>
          <textarea
            id="d4-doc-description"
            name="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            aria-required="true"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describedBy("d4-doc-description", false, !!errors.description)}
            className={`${controlClass(!!errors.description)} resize-y`}
          />
        </Field>
        <Field id="d4-doc-title" label="Tiêu đề" error={errors.title} counter={`${title.trim().length}/${TITLE_MAX}`}>
          <input
            id="d4-doc-title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            autoComplete="off"
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describedBy("d4-doc-title", false, !!errors.title)}
            className={controlClass(!!errors.title)}
          />
        </Field>

        <div className="space-y-2 rounded-lg border border-[var(--border-color)] p-3">
          <p className="text-sm font-medium">Mã sha256 của tài liệu</p>
          <p className="text-xs text-[var(--muted-text-color)]" id="d4-doc-pick-help">
            Chọn tệp trên máy để trình duyệt tự tính mã sha256. Tệp được đọc ngay trên máy của bạn và <strong>không được tải lên</strong>. Hoặc dán mã bạn đã tính ở nơi khác vào ô bên dưới.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* The native control prints its prompt in the browser's language ("No file chosen"); the input stays in the DOM (focusable, sr-only) and a label draws the Vietnamese button. */}
            <input
              key={pickerKey}
              id="d4-doc-pick"
              type="file"
              onChange={(e) => void onPick(e)}
              disabled={busy}
              aria-describedby="d4-doc-pick-help"
              data-testid="d4-doc-pick"
              className="peer sr-only"
            />
            <label
              htmlFor="d4-doc-pick"
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-md border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 text-sm font-medium text-[var(--text-color)] hover:brightness-110 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--primary-color)] peer-disabled:opacity-60 sm:min-h-9`}
            >
              Chọn tệp để tính mã
            </label>
            <span className="min-w-0 break-all text-sm text-[var(--muted-text-color)]" data-testid="d4-doc-picked">
              {hash.kind === "computing" || hash.kind === "done" ? hash.name : "Chưa chọn tệp"}
            </span>
            {hash.kind !== "idle" && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={clearPick} disabled={busy}>
                Bỏ tệp
              </Button>
            )}
          </div>
          <div aria-live="polite" data-testid="d4-hash-status" className="min-h-5 text-xs">
            {hash.kind === "computing" && <span>Đang tính mã cho «{hash.name}» ngay trên máy bạn…</span>}
            {hash.kind === "done" && <span>Đã tính xong mã cho «{hash.name}» ngay trên máy bạn. Tệp không được tải lên.</span>}
            {hash.kind === "failed" && <span className="text-st-danger">{hash.message}</span>}
          </div>
          <Field
            id="d4-doc-sha256"
            label="Mã sha256 (64 ký tự)"
            required
            error={errors.sha256}
            counter={`${shaLen}/64${shaLen === 64 && !isSha256(shaNorm) ? " · có ký tự không hợp lệ" : ""}`}
          >
            <input
              id="d4-doc-sha256"
              name="sha256"
              type="text"
              inputMode="text"
              value={sha}
              onChange={(e) => setSha(e.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-required="true"
              aria-invalid={errors.sha256 ? true : undefined}
              aria-describedby={describedBy("d4-doc-sha256", false, !!errors.sha256)}
              className={`${controlClass(!!errors.sha256)} font-mono text-sm`}
            />
          </Field>
          <p className="text-xs text-[var(--muted-text-color)]">Mã này là lời khai của bạn; hệ thống không kiểm lại vì không có tệp.</p>
        </div>

        <Field id="d4-doc-fileName" label="Tên tệp" hint="Chỉ để ghi chú; tệp không được gửi đi." error={errors.fileName} counter={`${fileName.trim().length}/${FILE_NAME_MAX}`}>
          <input
            id="d4-doc-fileName"
            name="fileName"
            type="text"
            value={fileName}
            onChange={(e) => {
              fileNameWasAuto.current = false;
              setFileName(e.target.value);
            }}
            disabled={busy}
            autoComplete="off"
            aria-invalid={errors.fileName ? true : undefined}
            aria-describedby={describedBy("d4-doc-fileName", true, !!errors.fileName)}
            className={controlClass(!!errors.fileName)}
          />
        </Field>

        {feedback && (
          <Notice tone={feedback.outcomeUnknown ? "warning" : "danger"} role="alert" testId="d4-document-error">
            <p>{feedback.message}</p>
            {feedback.notFound && (
              <p className="mt-1">
                {NOT_FOUND_TEXT}{" "}
                <PartyLink to={LIST_PATH} className={`font-semibold underline ${FOCUS}`}>
                  Về danh sách
                </PartyLink>
              </p>
            )}
          </Notice>
        )}
        {saved && (
          <Notice tone="info" role="status" testId="d4-document-saved">
            {saved}
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy || mustReload || hash.kind === "computing"} data-testid="d4-document-submit">
            {busy ? "Đang gửi…" : "Ghi tài liệu"}
          </button>
          {(mustReload || feedback?.outcomeUnknown) && <ReloadButton onClick={() => void reload()} busy={reloading} label="Tải lại hồ sơ" testId="d4-document-reload" />}
        </div>
        {mustReload && <p className="text-xs">Hãy tải lại hồ sơ trước, rồi gửi lại nếu vẫn cần.</p>}
      </form>
    </Panel>
  );
}
