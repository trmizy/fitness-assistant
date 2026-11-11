import { useState, type ChangeEvent, type FormEvent } from "react";
import { gymCaseApi } from "../admin/complaints/gymCaseApi";
import { parseGymError } from "../admin/complaints/gymCaseErrors";
import type { GymCreatedId, GymStatementResult } from "../admin/complaints/gymCaseTypes";
import { HASH_MESSAGE, sha256OfFile } from "../admin/complaints/gymSha256";
import { useIdempotentAction } from "../admin/disputes/useIdempotentAction";
import {
  Field,
  Notice,
  PRIMARY_BUTTON,
  Panel,
  controlClass,
} from "../disputes/PartyParts";
import {
  DESCRIPTION_MAX,
  FILE_NAME_MAX,
  REASON_MAX,
  STATEMENT_MAX,
  TITLE_MAX,
  isSha256,
  normalizeSha256,
  validateDocument,
  validateStatement,
  type FieldErrors,
} from "../disputes/partyModel";

// Cùng biểu mẫu dùng cho hội viên (mặc định) và cho chủ/quản lý phòng gym (ND-07): chỉ khác hàm gửi và vài câu chữ.
type SubmitStatement = (caseId: string, body: { text: string; supplementReason?: string }, key: string) => Promise<GymStatementResult>;
type SubmitDocument = (caseId: string, body: { description: string; sha256: string; title?: string; fileName?: string }, key: string) => Promise<GymCreatedId>;

// ───────────────────────────────────────────────────────── Statement Form ──
interface GymStatementFormProps {
  caseId: string;
  statementCount: number;
  onSaved: () => void;
  /** Mặc định: lời khai của hội viên (/me/complaint-cases). Phòng gym truyền hàm gửi lời giải trình của mình. */
  submit?: SubmitStatement;
  /** "gym": câu chữ dành cho chủ/quản lý phòng gym. */
  party?: "member" | "gym";
}

export function GymStatementForm({
  caseId,
  statementCount,
  onSaved,
  submit = gymCaseApi.submitStatement,
  party = "member",
}: GymStatementFormProps) {
  const gym = party === "gym";
  const needsReason = statementCount > 0;
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const action = useIdempotentAction<
    { text: string; supplementReason?: string },
    GymStatementResult
  >();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;

    const val = validateStatement(
      { text, supplementReason: reason },
      needsReason,
    );
    if ("errors" in val) {
      setErrors(val.errors);
      setFeedback(null);
      return;
    }

    setErrors({});
    setFeedback(null);
    setSuccess(null);

    const body = val.body;
    const res = await action.run(body, (key, b) =>
      submit(caseId, b, key),
    );

    if (res.status === "busy") return;
    if (res.status === "ok") {
      setSuccess(gym ? "Đã gửi lời giải trình." : "Đã gửi lời khai.");
      setText("");
      setReason("");
      onSaved();
    } else {
      const parsed = parseGymError(res.error, { action: "write" });
      setFeedback(parsed.message);
    }
  };

  return (
    <Panel id="gym-statement-form" title={gym ? "Gửi lời giải trình" : "Gửi lời khai"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {success && (
          <div
            role="status"
            className="rounded-lg border border-st-success-border bg-st-success-bg p-3 text-sm text-st-success"
          >
            {success}
          </div>
        )}
        {feedback && <Notice tone="danger">{feedback}</Notice>}

        <Field
          id="gym-statement-text"
          label={gym ? "Nội dung giải trình" : "Nội dung lời khai"}
          error={errors.text}
          required
        >
          <textarea
            id="gym-statement-text"
            rows={4}
            className={controlClass(!!errors.text)}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setErrors({ ...errors, text: undefined });
              setFeedback(null);
            }}
            placeholder={gym ? "Nêu rõ phòng gym đã xử lý hoặc ghi nhận sự việc này như thế nào..." : "Nêu rõ diễn biến sự việc theo lời khai của bạn..."}
            maxLength={STATEMENT_MAX}
            disabled={action.pending}
          />
        </Field>

        {needsReason && (
          <Field
            id="gym-statement-reason"
            label={gym ? "Lý do bổ sung (bắt buộc từ lần giải trình thứ hai)" : "Lý do bổ sung (Bắt buộc từ lần khai thứ hai)"}
            error={errors.supplementReason}
            required
          >
            <textarea
              id="gym-statement-reason"
              rows={2}
              className={controlClass(!!errors.supplementReason)}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErrors({ ...errors, supplementReason: undefined });
                setFeedback(null);
              }}
              placeholder={gym ? "Nêu lý do bạn gửi thêm giải trình..." : "Nêu lý do bạn gửi thêm lời khai..."}
              maxLength={REASON_MAX}
              disabled={action.pending}
            />
          </Field>
        )}

        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={action.pending || !text.trim()}
        >
          {action.pending ? "Đang gửi..." : gym ? "Gửi giải trình" : "Gửi lời khai"}
        </button>
      </form>
    </Panel>
  );
}

// ────────────────────────────────────────────────────────── Document Form ──
type HashState =
  | { kind: "idle" }
  | { kind: "computing"; name: string }
  | { kind: "done"; name: string }
  | { kind: "failed"; message: string };

interface GymDocumentFormProps {
  caseId: string;
  onSaved: () => void;
  /** Mặc định: tài liệu của hội viên. Phòng gym truyền hàm gửi bằng chứng của mình. */
  submit?: SubmitDocument;
}

export function GymDocumentForm({ caseId, onSaved, submit = gymCaseApi.submitEvidence }: GymDocumentFormProps) {
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [sha, setSha] = useState("");
  const [hash, setHash] = useState<HashState>({ kind: "idle" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const action = useIdempotentAction<
    { description: string; sha256: string; title?: string; fileName?: string },
    GymCreatedId
  >();

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHash({ kind: "computing", name: file.name });
    if (!fileName) setFileName(file.name);
    try {
      const res = await sha256OfFile(file);
      if (res.status === "ok") {
        setSha(res.hex);
        setHash({ kind: "done", name: file.name });
        setErrors((prev) => ({ ...prev, sha256: undefined }));
      } else {
        setHash({ kind: "failed", message: HASH_MESSAGE[res.status] });
      }
    } catch {
      setHash({ kind: "failed", message: "Không đọc được tệp." });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;

    const val = validateDocument({ description, title, fileName, sha256: sha });
    if ("errors" in val) {
      setErrors(val.errors);
      setFeedback(null);
      return;
    }

    setErrors({});
    setFeedback(null);
    setSuccess(null);

    const body = val.body;
    const res = await action.run(body, (key, b) =>
      submit(caseId, b, key),
    );

    if (res.status === "busy") return;
    if (res.status === "ok") {
      setSuccess("Đã lưu thông tin tài liệu.");
      setDescription("");
      setTitle("");
      setFileName("");
      setSha("");
      setHash({ kind: "idle" });
      onSaved();
    } else {
      const parsed = parseGymError(res.error, { action: "write" });
      setFeedback(parsed.message);
    }
  };

  return (
    <Panel id="gym-document-form" title="Khai báo tài liệu, bằng chứng">
      <form onSubmit={handleSubmit} className="space-y-3">
        <Notice tone="info">
          Bạn chưa gửi được tệp trực tiếp. Hãy nhập mô tả và mã sha256 của tệp
          bạn có; hệ thống ghi nhận mã đó là lời khai của bạn, chưa kiểm chứng.
        </Notice>

        {success && (
          <div
            role="status"
            className="rounded-lg border border-st-success-border bg-st-success-bg p-3 text-sm text-st-success"
          >
            {success}
          </div>
        )}
        {feedback && <Notice tone="danger">{feedback}</Notice>}

        <Field
          id="gym-doc-description"
          label="Mô tả tài liệu"
          error={errors.description}
          required
        >
          <textarea
            id="gym-doc-description"
            rows={3}
            className={controlClass(!!errors.description)}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setErrors({ ...errors, description: undefined });
              setFeedback(null);
            }}
            placeholder="Nêu rõ tài liệu này là gì và chứng minh điều gì..."
            maxLength={DESCRIPTION_MAX}
            disabled={action.pending}
          />
        </Field>

        <Field id="gym-doc-title" label="Tiêu đề tài liệu" error={errors.title}>
          <input
            id="gym-doc-title"
            type="text"
            className={controlClass(!!errors.title)}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors({ ...errors, title: undefined });
            }}
            placeholder="Ví dụ: Hoá đơn chuyển khoản, hợp đồng..."
            maxLength={TITLE_MAX}
            disabled={action.pending}
          />
        </Field>

        <Field
          id="gym-doc-filename"
          label="Tên tệp (tùy chọn)"
          error={errors.fileName}
        >
          <input
            id="gym-doc-filename"
            type="text"
            className={controlClass(!!errors.fileName)}
            value={fileName}
            onChange={(e) => {
              setFileName(e.target.value);
              setErrors({ ...errors, fileName: undefined });
            }}
            placeholder="Ví dụ: bien_lai.pdf"
            maxLength={FILE_NAME_MAX}
            disabled={action.pending}
          />
        </Field>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-[var(--text-color)]">
            Chọn tệp để tính mã sha256 tự động trên máy này (không tải tệp lên)
          </label>
          <input
            type="file"
            onChange={onFilePicked}
            className="block w-full text-xs text-[var(--muted-color)]"
            disabled={action.pending}
          />
          {hash.kind === "computing" && (
            <p className="text-xs text-[var(--muted-color)]">
              Đang tính mã sha256 cho {hash.name}...
            </p>
          )}
          {hash.kind === "done" && (
            <p className="text-xs text-st-success">
              Đã tính xong mã sha256 cho {hash.name}.
            </p>
          )}
          {hash.kind === "failed" && (
            <p className="text-xs text-st-danger">{hash.message}</p>
          )}
        </div>

        <Field
          id="gym-doc-sha256"
          label="Mã sha256 (64 ký tự thập lục phân)"
          error={errors.sha256}
          required
        >
          <input
            id="gym-doc-sha256"
            type="text"
            className={`${controlClass(!!errors.sha256)} font-mono text-xs`}
            value={sha}
            onChange={(e) => {
              setSha(normalizeSha256(e.target.value));
              setErrors({ ...errors, sha256: undefined });
              setFeedback(null);
            }}
            placeholder="Nhập hoặc dán mã sha256 gồm 64 ký tự..."
            disabled={action.pending}
          />
        </Field>

        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={action.pending || !description.trim() || !isSha256(sha)}
        >
          {action.pending ? "Đang lưu..." : "Lưu thông tin tài liệu"}
        </button>
      </form>
    </Panel>
  );
}

// ──────────────────────────────────────────────────────────── Appeal Form ──
interface GymMemberAppealFormProps {
  caseId: string;
  onSaved: () => void;
  closesAt?: string | null;
}

export function GymMemberAppealForm({
  caseId,
  onSaved,
  closesAt,
}: GymMemberAppealFormProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const action = useIdempotentAction<{ reason: string }, { appealId?: string }>();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;

    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Vui lòng nhập lý do yêu cầu xem xét lại.");
      return;
    }
    if (trimmed.length > 4000) {
      setError("Lý do không được vượt quá 4000 ký tự.");
      return;
    }

    setError(null);
    setFeedback(null);
    setSuccess(null);

    const body = { reason: trimmed };
    const res = await action.run(body, (key, b) =>
      gymCaseApi.submitMemberAppeal(caseId, b, key),
    );

    if (res.status === "busy") return;
    if (res.status === "ok") {
      setSuccess("Đã gửi yêu cầu xem xét lại. Kết quả hiện tại chưa thay đổi.");
      setReason("");
      onSaved();
    } else {
      const parsed = parseGymError(res.error, { action: "write" });
      setFeedback(parsed.message);
    }
  };

  return (
    <Panel id="gym-appeal-form" title="Yêu cầu xem xét lại kết quả">
      <div className="space-y-3">
        <Notice tone="info">
          Mỗi bên chỉ được yêu cầu xem xét lại một lần khi có thông báo kết quả.
        </Notice>

        {closesAt && (
          <p className="text-xs text-[var(--muted-color)]">
            Hạn chót yêu cầu: {new Date(closesAt).toLocaleString("vi-VN")}
          </p>
        )}

        {success && (
          <div
            role="status"
            className="rounded-lg border border-st-success-border bg-st-success-bg p-3 text-sm text-st-success"
          >
            {success}
          </div>
        )}
        {feedback && <Notice tone="danger">{feedback}</Notice>}

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field
              id="gym-member-appeal-reason"
              label="Lý do yêu cầu xem xét lại"
              required
              error={error ?? undefined}
            >
              <textarea
                id="gym-member-appeal-reason"
                rows={3}
                className={controlClass(!!error)}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                  setFeedback(null);
                }}
                placeholder="Nêu rõ lý do bạn đề nghị xem xét lại kết quả..."
                maxLength={4000}
                disabled={action.pending}
              />
            </Field>

            <button
              type="submit"
              className={PRIMARY_BUTTON}
              disabled={action.pending || !reason.trim()}
            >
              {action.pending ? "Đang gửi..." : "Gửi yêu cầu xem xét lại"}
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}
