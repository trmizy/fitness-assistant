import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon as ArrowLeft,
  CaretRightIcon as ChevronRight,
  CircleNotchIcon as Loader2,
  DownloadSimpleIcon as Download,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@phosphor-icons/react";
import {
  CATEGORY_LABEL,
  DOC_LABEL,
  DOC_STATUS_LABEL,
  ISSUE_STATUS_LABEL,
  PHOTO_CATEGORY_LABEL,
  ROLE_LABEL,
  adminPartnerApplications,
  friendlyError,
  type AdminApplicationDetail,
  type AdminApplicationRow,
  type DocType,
  type ReviewCategory,
} from "../../services/partnerApplication";

type Filter = AdminApplicationRow["verificationStatus"];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "IN_REVIEW", label: "Chờ duyệt" },
  { key: "NEEDS_INFO", label: "Đã yêu cầu sửa" },
  { key: "NOT_VERIFIED", label: "Đang soạn" },
  { key: "REJECTED", label: "Đã từ chối" },
  { key: "VERIFIED", label: "Đã duyệt" },
];

const dt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const HISTORY_LABEL: Record<string, string> = {
  APPLICATION_SUBMITTED: "Ứng viên gửi hồ sơ",
  APPLICATION_RESUBMITTED: "Ứng viên gửi lại hồ sơ",
  CHANGES_REQUESTED: "Yêu cầu chỉnh sửa",
  ISSUE_MARKED_UPDATED: "Ứng viên đánh dấu đã cập nhật",
  ISSUE_RESOLVED: "Đóng vấn đề",
  DOCUMENT_UPLOADED: "Tải lên giấy tờ",
  DOCUMENT_REPLACED: "Thay giấy tờ",
  DOCUMENT_ACCEPTED: "Chấp nhận giấy tờ",
  DOCUMENT_UPDATE_REQUESTED: "Yêu cầu cập nhật giấy tờ",
  DOCUMENT_VIEWED: "Xem giấy tờ",
  APPLICATION_APPROVED: "Phê duyệt hồ sơ",
  APPLICATION_REJECTED: "Từ chối hồ sơ",
  APPLICATION_REOPENED: "Mở lại hồ sơ",
};

const box = "bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4";
const inputCls = "w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50";

/** Hàng đợi hồ sơ đối tác tự đăng ký + màn duyệt chi tiết. */
export function AdminApplicationsPanel({ initialId, onOpenPartner }: { initialId?: string | null; onOpenPartner: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("IN_REVIEW");
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);

  const q = useQuery({
    queryKey: ["admin-applications", filter],
    queryFn: () => adminPartnerApplications.list(filter),
    refetchOnMount: "always",
  });
  const counts = useQuery({ queryKey: ["admin-applications", "counts"], queryFn: () => adminPartnerApplications.list(), staleTime: 0 });

  if (openId) return <ApplicationDetail id={openId} onBack={() => setOpenId(null)} onOpenPartner={onOpenPartner} />;

  const total = counts.data?.counts?.IN_REVIEW ?? 0;
  return (
    <div className="space-y-5">
      <div className={box}>
        <p className="text-sm text-zinc-300">
          <span className="text-2xl font-bold text-amber-400 mr-2">{total}</span>
          hồ sơ đang chờ duyệt
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f.key ? "bg-green-500 text-black" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800/60 border border-zinc-800/60"
            }`}
          >
            {f.label}
            {counts.data?.counts?.[f.key] ? ` (${counts.data.counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : q.isError ? (
        <p className="text-sm text-red-400">{friendlyError(q.error).message}</p>
      ) : !q.data || q.data.items.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-10">Không có hồ sơ nào ở mục này.</p>
      ) : (
        <div className="space-y-2.5">
          {q.data.items.map((r) => (
            <button
              key={r.id}
              onClick={() => setOpenId(r.id)}
              className="w-full text-left bg-zinc-900 rounded-xl border border-zinc-800/60 hover:border-zinc-700 p-4 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-200 truncate">{r.brandName ?? r.legalName ?? "(chưa đặt tên thương hiệu)"}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {r.applicantName ?? "—"} · {r.contactEmail}
                  </p>
                  <p className="text-[11px] text-zinc-600 mt-1">
                    Chi nhánh đầu: {r.firstBranchName ?? "chưa có"} · {r.businessScale === "MULTIPLE_BRANCHES" ? "nhiều chi nhánh" : r.businessScale === "ONE_BRANCH" ? "một chi nhánh" : "chưa chọn quy mô"}
                    {r.submittedAt ? ` · gửi ${dt(r.submittedAt)}` : ` · tạo ${dt(r.createdAt)}`}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0 mt-1" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationDetail({ id, onBack, onOpenPartner }: { id: string; onBack: () => void; onOpenPartner: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-application", id], queryFn: () => adminPartnerApplications.get(id), refetchOnMount: "always" });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-application", id] });
    qc.invalidateQueries({ queryKey: ["admin-applications"] });
    qc.invalidateQueries({ queryKey: ["admin-partner-queue"] });
  };

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="text-xs text-zinc-400 flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
        </button>
        <p className="text-sm text-red-400">{friendlyError(q.error, "Không tải được hồ sơ.").message}</p>
      </div>
    );
  }
  const d = q.data;
  const underReview = d.partner.verificationStatus === "IN_REVIEW";

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Danh sách hồ sơ
      </button>
      <div>
        <h2 className="text-lg font-bold text-zinc-100">{d.brand?.name ?? d.partner.legalName ?? "Hồ sơ đối tác"}</h2>
        <p className="text-xs text-zinc-500">
          {d.partner.contactEmail} · {d.partner.submittedAt ? `gửi ${dt(d.partner.submittedAt)}` : "chưa gửi"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4 min-w-0">
          <Content d={d} />
          <History d={d} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <DocumentsPanel id={id} d={d} onChanged={invalidate} canReview={underReview} />
          <IssuesPanel id={id} d={d} onChanged={invalidate} />
          <ActionsPanel id={id} d={d} onChanged={invalidate} onOpenPartner={onOpenPartner} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-200">{value || <span className="text-zinc-600">—</span>}</dd>
    </div>
  );
}

function Content({ d }: { d: AdminApplicationDetail }) {
  return (
    <div className="space-y-4">
      <section className={box}>
        <h3 className="text-sm font-bold text-zinc-200 mb-3">Người đại diện & thương hiệu</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Họ tên" value={d.partner.representativeName} />
          <Row label="Vai trò" value={d.partner.representativeRole ? ROLE_LABEL[d.partner.representativeRole] : null} />
          <Row label="Điện thoại" value={d.representativePhone} />
          <Row label="Email" value={d.partner.contactEmail} />
          <Row label="Thương hiệu" value={d.brand?.name} />
          <div>
            <dt className="text-[11px] text-zinc-500">Logo thương hiệu</dt>
            <dd className="text-sm text-zinc-200">
              {d.brand?.logoUrl ? (
                <img src={d.brand.logoUrl} alt="Logo thương hiệu" className="mt-1 h-12 w-12 rounded border border-zinc-800 bg-zinc-950 object-contain" />
              ) : (
                <span className="text-zinc-600">Chưa có (không bắt buộc)</span>
              )}
            </dd>
          </div>
          <Row label="Quy mô" value={d.partner.businessScale === "MULTIPLE_BRANCHES" ? "Nhiều chi nhánh" : d.partner.businessScale === "ONE_BRANCH" ? "Một chi nhánh" : null} />
          <Row label="Tên pháp lý" value={d.partner.legalName} />
          <Row label="Mã số thuế" value={d.partner.taxCode} />
          <Row label="Số giấy phép" value={d.partner.businessLicenseNo} />
        </dl>
      </section>

      <section className={box}>
        <h3 className="text-sm font-bold text-zinc-200 mb-3">Chi nhánh đầu tiên</h3>
        {d.branch ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Tên" value={d.branch.name} />
            <Row label="Điện thoại" value={d.branch.phone} />
            <Row label="Địa chỉ" value={d.branch.address} />
            <Row label="Chỉ dẫn" value={d.branch.locationNote} />
            <Row label="Toạ độ" value={d.branch.latitude != null && d.branch.longitude != null ? `${d.branch.latitude.toFixed(5)}, ${d.branch.longitude.toFixed(5)}` : null} />
            <Row label="Mô tả" value={d.branch.description} />
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">Chưa có chi nhánh.</p>
        )}
        {d.branch?.latitude != null && d.branch?.longitude != null && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${d.branch.latitude}&mlon=${d.branch.longitude}#map=17/${d.branch.latitude}/${d.branch.longitude}`}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-xs text-green-400 hover:text-green-300"
          >
            Xem vị trí trên bản đồ
          </a>
        )}
      </section>

      <section className={box}>
        <h3 className="text-sm font-bold text-zinc-200 mb-3">Ảnh cơ sở ({d.photos.length})</h3>
        {d.photos.length === 0 ? (
          <p className="text-sm text-zinc-500">Chưa có ảnh.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {d.photos.map((p) => (
              <li key={p.id} className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
                <div className="aspect-[4/3] bg-zinc-800">
                  {p.url ? <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" /> : null}
                </div>
                <p className="px-2 py-1 text-[11px] text-zinc-400">
                  {p.category ? PHOTO_CATEGORY_LABEL[p.category] : "Ảnh"}
                  {p.isCover ? " · bìa" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DocumentsPanel({ id, d, onChanged, canReview }: { id: string; d: AdminApplicationDetail; onChanged: () => void; canReview: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);

  const view = async (docType: DocType) => {
    setBusy(docType);
    try {
      const r = await adminPartnerApplications.documentFile(id, docType);
      window.open(r.url, "_blank", "noopener,noreferrer");
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e).message);
    } finally {
      setBusy(null);
    }
  };
  const accept = async (docType: DocType) => {
    setBusy(docType);
    try {
      await adminPartnerApplications.acceptDocument(id, docType);
      toast.success("Đã chấp nhận giấy tờ");
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={box}>
      <h3 className="text-sm font-bold text-zinc-200 mb-3">Giấy tờ</h3>
      <ul className="space-y-2.5">
        {d.documents.map((doc) => (
          <li key={doc.docType} className="rounded-lg border border-zinc-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-200">
                  {DOC_LABEL[doc.docType as DocType]}
                  {doc.required && <span className="text-red-400"> *</span>}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {DOC_STATUS_LABEL[doc.status]}
                  {doc.hasFile ? ` · v${doc.version}` : ""}
                </p>
                {doc.status === "REJECTED" && doc.reviewNote && <p className="text-[11px] text-amber-300 mt-0.5">Đã yêu cầu cập nhật: {doc.reviewNote}</p>}
              </div>
              {doc.hasFile && (
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => view(doc.docType as DocType)} disabled={busy === doc.docType} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-500 disabled:opacity-50">
                    <Download className="w-3 h-3" /> Xem
                  </button>
                  {canReview && doc.status === "RECEIVED" && (
                    <button onClick={() => accept(doc.docType as DocType)} disabled={busy === doc.docType} className="rounded-md bg-green-500 px-2 py-1 text-[11px] font-bold text-black hover:bg-green-400 disabled:opacity-50">
                      Chấp nhận
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-zinc-600">Mỗi lần xem giấy tờ đều được ghi vào nhật ký.</p>
    </section>
  );
}

function IssuesPanel({ id, d, onChanged }: { id: string; d: AdminApplicationDetail; onChanged: () => void }) {
  const [reopening, setReopening] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setReopening(null);
      setMsg("");
      onChanged();
    },
    onError: (e) => toast.error(friendlyError(e).message),
  });
  if (d.issues.length === 0) return null;
  return (
    <section className={box}>
      <h3 className="text-sm font-bold text-zinc-200 mb-3">Vấn đề đã yêu cầu</h3>
      <ul className="space-y-2.5">
        {d.issues.map((i) => (
          <li key={i.id} className="rounded-lg border border-zinc-800 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-300">{CATEGORY_LABEL[i.category]}</span>
              <span className="text-[11px] text-zinc-400">{ISSUE_STATUS_LABEL[i.status]}</span>
            </div>
            <p className="text-xs text-zinc-200">{i.message}</p>
            {i.resubmitNote && <p className="text-[11px] text-zinc-500">Ứng viên: {i.resubmitNote}</p>}
            {(i.status === "RESUBMITTED" || i.status === "RESOLVED") && (
              <div className="flex gap-1.5 pt-1">
                {i.status === "RESUBMITTED" && (
                  <button onClick={() => act.mutate(() => adminPartnerApplications.resolveIssue(id, i.id))} disabled={act.isPending} className="rounded-md bg-green-500 px-2 py-1 text-[11px] font-bold text-black hover:bg-green-400 disabled:opacity-50">
                    Đóng
                  </button>
                )}
                <button onClick={() => setReopening(reopening === i.id ? null : i.id)} className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-500">
                  Yêu cầu lại
                </button>
              </div>
            )}
            {reopening === i.id && (
              <div className="space-y-1.5 pt-1">
                <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Nội dung yêu cầu lại" className={inputCls} />
                <button onClick={() => act.mutate(() => adminPartnerApplications.reopenIssue(id, i.id, msg.trim()))} disabled={act.isPending || msg.trim().length < 3} className="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50">
                  Gửi yêu cầu
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ReviewCategory[];

function ActionsPanel({ id, d, onChanged, onOpenPartner }: { id: string; d: AdminApplicationDetail; onChanged: () => void; onOpenPartner: (id: string) => void }) {
  const [mode, setMode] = useState<"changes" | "reject" | null>(null);
  const [issues, setIssues] = useState<{ category: ReviewCategory; message: string }[]>([{ category: "PHOTOS", message: "" }]);
  const [docNotes, setDocNotes] = useState<Partial<Record<DocType, string>>>({});
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setMode(null);
      onChanged();
    },
    onError: (e) => toast.error(friendlyError(e).message),
  });

  const v = d.partner.verificationStatus;
  const canApprove = d.approve.canApprove;
  const cleanIssues = issues.filter((i) => i.message.trim().length >= 3);
  const cleanDocs = (Object.entries(docNotes) as [DocType, string][]).filter(([, n]) => n.trim().length >= 3).map(([docType, note]) => ({ docType, note: note.trim() }));

  return (
    <section className={box}>
      <h3 className="text-sm font-bold text-zinc-200 mb-3">Quyết định</h3>

      {v === "VERIFIED" && (
        <div className="space-y-2">
          <p className="text-sm text-green-400">Hồ sơ đã được phê duyệt.</p>
          <button onClick={() => onOpenPartner(id)} className="text-xs text-green-400 hover:text-green-300">Mở hồ sơ đối tác →</button>
        </div>
      )}

      {v === "REJECTED" && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">Hồ sơ đã bị từ chối{d.partner.rejectionReason ? `: ${d.partner.rejectionReason}` : ""}.</p>
          <button
            onClick={() => window.confirm("Mở lại hồ sơ để ứng viên chỉnh sửa và nộp lại?") && run.mutate(() => adminPartnerApplications.reopen(id))}
            disabled={run.isPending}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
          >
            Mở lại hồ sơ
          </button>
        </div>
      )}

      {v === "IN_REVIEW" && (
        <div className="space-y-3">
          {!canApprove && (
            <ul className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
              {d.approve.blockers.map((b: any, i: number) => (
                <li key={i} className="text-[11px] text-amber-300">• {b?.message ?? String(b)}</li>
              ))}
            </ul>
          )}
          <div className="grid gap-2">
            <button
              onClick={() =>
                window.confirm(
                  "Phê duyệt hồ sơ? Đối tác trở thành chủ phòng tập đang hoạt động và chi nhánh đầu tiên được duyệt cùng lúc.",
                ) && run.mutate(() => adminPartnerApplications.approve(id))
              }
              disabled={!canApprove || run.isPending}
              className="rounded-lg bg-green-500 px-3 py-2.5 text-sm font-bold text-black hover:bg-green-400 disabled:opacity-40"
            >
              Phê duyệt hồ sơ
            </button>
            <button onClick={() => setMode(mode === "changes" ? null : "changes")} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-500">
              Yêu cầu chỉnh sửa
            </button>
            <button onClick={() => setMode(mode === "reject" ? null : "reject")} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">
              Từ chối hồ sơ
            </button>
          </div>

          {mode === "changes" && (
            <div className="space-y-3 border-t border-zinc-800 pt-3">
              <p className="text-[11px] text-zinc-500">Vấn đề theo mục</p>
              {issues.map((it, idx) => (
                <div key={idx} className="flex gap-1.5">
                  <select value={it.category} onChange={(e) => setIssues((l) => l.map((x, j) => (j === idx ? { ...x, category: e.target.value as ReviewCategory } : x)))} className="w-32 shrink-0 px-2 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                    ))}
                  </select>
                  <input value={it.message} onChange={(e) => setIssues((l) => l.map((x, j) => (j === idx ? { ...x, message: e.target.value } : x)))} placeholder="Cần sửa gì?" className={inputCls} />
                  {issues.length > 1 && (
                    <button aria-label="Xoá" onClick={() => setIssues((l) => l.filter((_, j) => j !== idx))} className="p-2 text-zinc-500 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setIssues((l) => [...l, { category: "OTHER", message: "" }])} className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300">
                <Plus className="w-3.5 h-3.5" /> Thêm vấn đề
              </button>

              <p className="text-[11px] text-zinc-500 pt-1">Giấy tờ cần cập nhật (bỏ trống nếu không cần)</p>
              {d.documents.filter((x) => x.hasFile && x.status !== "VERIFIED").map((x) => (
                <input key={x.docType} value={docNotes[x.docType as DocType] ?? ""} onChange={(e) => setDocNotes((n) => ({ ...n, [x.docType]: e.target.value }))} placeholder={`${DOC_LABEL[x.docType as DocType]} — lý do`} className={inputCls} />
              ))}

              <button
                onClick={() => run.mutate(() => adminPartnerApplications.requestChanges(id, { issues: cleanIssues, documents: cleanDocs }))}
                disabled={run.isPending || (cleanIssues.length === 0 && cleanDocs.length === 0)}
                className="w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
              >
                Gửi yêu cầu chỉnh sửa
              </button>
            </div>
          )}

          {mode === "reject" && (
            <div className="space-y-2 border-t border-zinc-800 pt-3">
              <p className="text-[11px] text-zinc-500">Từ chối là kết quả cuối với ứng viên cho tới khi bạn mở lại hồ sơ.</p>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Lý do (hiển thị cho ứng viên)" className={inputCls} />
              <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} rows={2} placeholder="Ghi chú thêm (không bắt buộc)" className={inputCls} />
              <button
                onClick={() => run.mutate(() => adminPartnerApplications.reject(id, reason.trim(), adminNote.trim() || undefined))}
                disabled={run.isPending || reason.trim().length < 3}
                className="w-full rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                Xác nhận từ chối
              </button>
            </div>
          )}
        </div>
      )}

      {v === "NEEDS_INFO" && <p className="text-sm text-zinc-400">Đang chờ ứng viên chỉnh sửa và gửi lại.</p>}
      {v === "NOT_VERIFIED" && <p className="text-sm text-zinc-400">Ứng viên chưa gửi hồ sơ.</p>}
    </section>
  );
}

function History({ d }: { d: AdminApplicationDetail }) {
  return (
    <section className={box}>
      <h3 className="text-sm font-bold text-zinc-200 mb-3">Lịch sử</h3>
      {d.history.length === 0 ? (
        <p className="text-sm text-zinc-500">Chưa có sự kiện.</p>
      ) : (
        <ol className="space-y-2">
          {d.history.map((h) => (
            <li key={h.id} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-zinc-300">
                {HISTORY_LABEL[h.action] ?? h.action}
                {h.reason ? <span className="text-zinc-500"> — {h.reason}</span> : null}
              </span>
              <span className="text-zinc-600 shrink-0">{dt(h.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
