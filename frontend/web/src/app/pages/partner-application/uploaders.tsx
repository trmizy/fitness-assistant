import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CameraIcon as Camera,
  CircleNotchIcon as Loader2,
  TrashIcon as Trash2,
  StarIcon as Star,
  ArrowUpIcon as ArrowUp,
  ArrowDownIcon as ArrowDown,
  FileTextIcon as FileText,
  UploadSimpleIcon as Upload,
  LockKeyIcon as Lock,
  ImageSquareIcon as ImageSquare,
  PlusIcon as Plus,
  XIcon as X,
} from "@phosphor-icons/react";
import {
  ACCEPTED_DOC_TYPES,
  ACCEPTED_PHOTO_TYPES,
  DOC_LABEL,
  DOC_STATUS_LABEL,
  MAX_FILES_PER_DOCUMENT,
  MAX_UPLOAD_BYTES,
  PHOTO_CATEGORY_LABEL,
  friendlyError,
  partnerApplication,
  uploadApplicationFile,
  type ApplicationDocument,
  type ApplicationDocumentFile,
  type ApplicationPhoto,
  type DocType,
  type DocStatus,
  type PhotoCategory,
} from "../../services/partnerApplication";
import { inputCls } from "./ui";

function checkFile(file: File, accepted: string[]): string | null {
  if (!accepted.includes(file.type)) return "Định dạng không được hỗ trợ.";
  if (file.size > MAX_UPLOAD_BYTES) return "Tệp quá lớn (tối đa 10 MB).";
  if (file.size === 0) return "Tệp rỗng.";
  return null;
}

const PHOTO_CATEGORIES = Object.keys(PHOTO_CATEGORY_LABEL) as PhotoCategory[];

interface Job {
  key: string;
  name: string;
  percent: number;
  error?: string;
  file: File;
  category: PhotoCategory;
}

export function PhotoUploader({
  photos,
  minPhotos,
  disabled,
  onChanged,
}: {
  photos: ApplicationPhoto[];
  minPhotos: number;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<PhotoCategory>("EXTERIOR");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (job: Job) => {
    setJobs((j) => j.map((x) => (x.key === job.key ? { ...x, error: undefined, percent: 0 } : x)));
    try {
      await uploadApplicationFile(job.file, { kind: "PHOTO", photoCategory: job.category }, (p) =>
        setJobs((j) => j.map((x) => (x.key === job.key ? { ...x, percent: p } : x))),
      );
      setJobs((j) => j.filter((x) => x.key !== job.key));
      onChanged();
    } catch (e) {
      setJobs((j) => j.map((x) => (x.key === job.key ? { ...x, error: friendlyError(e, "Tải ảnh thất bại.").message } : x)));
    }
  };

  const onPick = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const problem = checkFile(file, ACCEPTED_PHOTO_TYPES);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        return;
      }
      const job: Job = { key: `${Date.now()}-${Math.random()}`, name: file.name, percent: 0, file, category };
      setJobs((j) => [...j, job]);
      void run(job);
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e).message);
    } finally {
      setBusyId(null);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const ids = photos.map((p) => p.id);
    const to = idx + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    void act(photos[idx].id, () => partnerApplication.reorderPhotos(ids));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory)} disabled={disabled} className={inputCls} aria-label="Loại ảnh">
          {PHOTO_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PHOTO_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold"
        >
          <Camera className="w-4 h-4" /> Chọn ảnh
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => onPick(e.target.files)} />
      </div>
      <p className="text-[11px] text-zinc-600">
        Cần tối thiểu {minPhotos} ảnh thật của cơ sở (mặt tiền, khu tập, thiết bị). JPG, PNG hoặc WebP, tối đa 10 MB mỗi ảnh. Ảnh chỉ hiển thị công khai sau khi hồ sơ được duyệt.
      </p>

      {jobs.length > 0 && (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.key} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-zinc-300">{j.name}</span>
                {j.error ? (
                  <span className="flex gap-2 shrink-0">
                    <button onClick={() => run(j)} className="text-green-400 hover:text-green-300">Thử lại</button>
                    <button onClick={() => setJobs((x) => x.filter((y) => y.key !== j.key))} className="text-zinc-500 hover:text-zinc-300">Bỏ</button>
                  </span>
                ) : (
                  <span className="text-zinc-500 shrink-0">{j.percent}%</span>
                )}
              </div>
              {j.error ? (
                <p className="text-red-400 mt-1">{j.error}</p>
              ) : (
                <div className="mt-1.5 h-1 rounded-full bg-zinc-800">
                  <div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${j.percent}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {photos.map((p, i) => (
            <li key={p.id} className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
              <div className="relative aspect-[4/3] bg-zinc-800">
                {p.url ? <img src={p.url} alt={p.category ? PHOTO_CATEGORY_LABEL[p.category] : "Ảnh cơ sở"} loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[11px] text-zinc-600">Đang xử lý</div>}
                {p.isCover && <span className="absolute top-1.5 left-1.5 rounded bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-black">Ảnh bìa</span>}
                {busyId === p.id && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
              </div>
              <div className="p-2 space-y-1.5">
                <p className="text-[11px] text-zinc-400 truncate">{p.category ? PHOTO_CATEGORY_LABEL[p.category] : "Ảnh"}</p>
                {!disabled && (
                  <div className="flex items-center justify-between">
                    <span className="flex gap-1">
                      <IconBtn label="Lên" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Xuống" onClick={() => move(i, 1)} disabled={i === photos.length - 1}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Đặt làm ảnh bìa" onClick={() => act(p.id, () => partnerApplication.setCover(p.id))} disabled={p.isCover}><Star className="w-3.5 h-3.5" /></IconBtn>
                    </span>
                    <IconBtn label="Xoá ảnh" onClick={() => act(p.id, () => partnerApplication.deletePhoto(p.id))}><Trash2 className="w-3.5 h-3.5 text-red-400" /></IconBtn>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-800 disabled:opacity-30">
      {children}
    </button>
  );
}

const DOC_BADGE: Record<DocStatus, string> = {
  PENDING: "bg-zinc-800 text-zinc-400",
  RECEIVED: "bg-blue-500/10 text-blue-300",
  VERIFIED: "bg-green-500/10 text-green-400",
  REJECTED: "bg-amber-500/10 text-amber-300",
};

/** Gợi ý theo loại giấy tờ — người dùng thường không biết cần tải những gì. */
const DOC_HINT: Partial<Record<DocType, string>> = {
  REPRESENTATIVE_ID: "Tải cả mặt trước và mặt sau (CCCD, CMND hoặc hộ chiếu).",
  BUSINESS_LICENSE: "Giấy phép nhiều trang thì tải từng trang, hoặc một tệp PDF.",
};

const mb = (bytes: number | null) => (bytes ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : "");

/**
 * Một giấy tờ gồm 1..MAX_FILES_PER_DOCUMENT tệp. Ảnh hiện thumbnail, bấm để phóng to; PDF bấm để tải về
 * (giấy tờ PDF luôn ép tải xuống — chính sách bảo mật). Mỗi lần mở đều xin link ký mới từ server.
 */
export function DocumentUpload({
  doc,
  disabled,
  onChanged,
}: {
  doc: ApplicationDocument;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; index: number } | null>(null);
  const locked = disabled || doc.status === "VERIFIED";
  const docType = doc.docType as DocType;
  const room = MAX_FILES_PER_DOCUMENT - doc.files.length;

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (!files.length) return;
    if (files.length > room) {
      setError(`Mỗi giấy tờ tối đa ${MAX_FILES_PER_DOCUMENT} tệp — còn thêm được ${room} tệp.`);
      return;
    }
    const problem = files.map((f) => checkFile(f, ACCEPTED_DOC_TYPES)).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      // Tuần tự: server đếm số tệp trong khoá, và thanh tiến độ dễ hiểu hơn.
      for (const file of files) {
        setPercent(0);
        await uploadApplicationFile(file, { kind: "DOCUMENT", docType }, setPercent);
        onChanged();
      }
    } catch (e) {
      setError(friendlyError(e, "Tải tệp thất bại.").message);
      onChanged();
    } finally {
      setPercent(null);
    }
  };

  const open = async (file: ApplicationDocumentFile, index: number) => {
    setBusyId(file.id);
    // PDF: mở tab trước khi chờ mạng để trình duyệt không chặn popup.
    const tab = file.mimeType === "application/pdf" ? window.open("", "_blank") : null;
    try {
      const r = await partnerApplication.documentFile(docType, file.id);
      if (tab) {
        tab.opener = null;
        tab.location.href = r.url;
      } else {
        setPreview({ url: r.url, index });
      }
    } catch (e) {
      tab?.close();
      toast.error(friendlyError(e, "Không mở được tệp.").message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (file: ApplicationDocumentFile) => {
    setBusyId(file.id);
    try {
      await partnerApplication.removeDocumentFile(docType, file.id);
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e, "Không xoá được tệp.").message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={`rounded-xl border p-3.5 ${doc.status === "REJECTED" ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
            {DOC_LABEL[docType] ?? doc.docType}
            {doc.required && <span className="text-red-400">*</span>}
          </p>
          {DOC_HINT[docType] && !locked && <p className="text-[11px] text-zinc-500 mt-0.5">{DOC_HINT[docType]}</p>}
          {doc.version > 1 && doc.hasFile && <p className="text-[11px] text-zinc-600 mt-0.5">Lần nộp thứ {doc.version}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${DOC_BADGE[doc.status]}`}>{DOC_STATUS_LABEL[doc.status]}</span>
      </div>

      {doc.status === "REJECTED" && doc.reviewNote && (
        <p className="mt-2 text-xs text-amber-300">
          <span className="font-semibold">Lý do cần cập nhật:</span> {doc.reviewNote}
        </p>
      )}

      {doc.files.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {doc.files.map((f, i) => (
            <li key={f.id} className="relative">
              <button
                type="button"
                onClick={() => open(f, i)}
                disabled={busyId === f.id}
                aria-label={`Xem tệp ${i + 1}`}
                className="block w-full aspect-[4/3] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 disabled:opacity-60"
              >
                {f.previewUrl ? (
                  <img src={f.previewUrl} alt={`Tệp ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-400">
                    <FileText className="w-7 h-7" />
                    <span className="text-[11px] font-semibold">{f.mimeType === "application/pdf" ? "PDF" : "Tệp"}</span>
                  </span>
                )}
                {busyId === f.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-200" />
                  </span>
                )}
              </button>
              <p className="mt-1 text-[10px] text-zinc-500 truncate">
                Tệp {i + 1}
                {f.sizeBytes ? ` · ${mb(f.sizeBytes)}` : ""}
              </p>
              {!locked && (
                <button
                  type="button"
                  onClick={() => remove(f)}
                  disabled={busyId === f.id}
                  aria-label={`Xoá tệp ${i + 1}`}
                  className="absolute top-1 right-1 rounded-full bg-black/70 p-1 text-zinc-200 hover:bg-red-500/80 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {percent !== null && (
        <div className="mt-2.5 h-1 rounded-full bg-zinc-800">
          <div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {!locked && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={percent !== null || room <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-50 px-3 py-2 text-xs font-semibold text-zinc-200"
          >
            {percent !== null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : doc.files.length ? <Plus className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
            {doc.files.length ? "Thêm tệp" : "Tải tệp lên"}
          </button>
          <span className="text-[11px] text-zinc-600">
            {room <= 0 ? `Đã đủ ${MAX_FILES_PER_DOCUMENT} tệp — xoá bớt để thêm` : `PDF, JPG, PNG · tối đa ${MAX_FILES_PER_DOCUMENT} tệp`}
          </span>
          <input ref={inputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => pick(e.target.files)} />
        </div>
      )}
      {doc.status === "VERIFIED" && <p className="mt-2 text-[11px] text-zinc-600">Giấy tờ đã được xác minh, không thể thay đổi.</p>}

      {preview && (
        <ImagePreview title={`${DOC_LABEL[docType]} — tệp ${preview.index + 1}`} url={preview.url} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

/** Lớp phủ phóng to ảnh giấy tờ: bấm nền, nút đóng hoặc phím Esc để thoát. */
function ImagePreview({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-zinc-200 truncate">{title}</p>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-full bg-zinc-800 p-1.5 text-zinc-200 hover:bg-zinc-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <img src={url} alt={title} className="max-h-[80vh] w-full rounded-lg bg-black object-contain" />
      </div>
    </div>
  );
}

export function PrivateNotice() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-zinc-500">
      <Lock className="w-3.5 h-3.5 shrink-0 mt-px" />
      Giấy tờ chỉ được Gymini dùng để xác minh doanh nghiệp, được lưu riêng tư và không bao giờ hiển thị công khai.
    </p>
  );
}

/**
 * Logo thương hiệu — TUỲ CHỌN. Không nằm trong danh sách "còn thiếu", không chặn nộp hồ sơ; chủ gym
 * tự thêm khi nào muốn, và thay lúc nào cũng được. Phải có tên thương hiệu trước (server đòi brand
 * tồn tại rồi mới cấp quyền tải lên).
 */
export function BrandLogoUpload({
  logoUrl,
  disabled,
  onChanged,
}: {
  logoUrl: string | null;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";
    const problem = checkFile(file, ACCEPTED_PHOTO_TYPES);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPercent(0);
    try {
      await uploadApplicationFile(file, { kind: "LOGO" }, setPercent);
      onChanged();
    } catch (e) {
      setError(friendlyError(e, "Tải logo thất bại.").message);
    } finally {
      setPercent(null);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
      <div className="flex items-center gap-3.5">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 flex items-center justify-center">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo thương hiệu" className="h-full w-full object-contain" />
          ) : (
            <ImageSquare className="h-6 w-6 text-zinc-700" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-200">
            Logo thương hiệu <span className="font-normal text-zinc-500">· không bắt buộc</span>
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">JPG, PNG hoặc WebP. Bỏ qua cũng được, thêm sau lúc nào cũng được.</p>
          {percent !== null && (
            <div className="mt-2 h-1 rounded-full bg-zinc-800">
              <div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${percent}%` }} />
            </div>
          )}
          {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
          {!disabled && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={percent !== null}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
            >
              {percent !== null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {logoUrl ? "Thay logo" : "Tải logo lên"}
            </button>
          )}
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  );
}
