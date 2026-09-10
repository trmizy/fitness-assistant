import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon, CheckCircleIcon, ClockIcon, XCircleIcon, UploadSimpleIcon, FileTextIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import { AuthenticatedImage } from "../../ui/AuthenticatedImage";
import type { BranchDocumentType, GymBranchDocument, PartnerDocumentContext, PartnerDocumentStatus } from "../../../types";

const DOC_LABEL: Record<BranchDocumentType, string> = {
  LEASE_OR_PROPERTY_DOC: "Hợp đồng thuê / giấy tờ sở hữu mặt bằng",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC",
  FACILITY_PHOTOS: "Ảnh thực địa cơ sở vật chất",
};
const DOC_ORDER: BranchDocumentType[] = ["LEASE_OR_PROPERTY_DOC", "FIRE_SAFETY_CERTIFICATE", "FACILITY_PHOTOS"];

const PARTNER_DOC_LABEL: Record<string, string> = {
  BUSINESS_LICENSE: "Giấy phép kinh doanh",
  REPRESENTATIVE_ID: "CCCD người đại diện",
  PREMISES_PROOF: "Giấy tờ mặt bằng (đối tác)",
  TAX_CODE_CERTIFICATE: "Chứng nhận mã số thuế",
  SITE_PHOTOS: "Ảnh thực địa (đối tác)",
  FIRE_SAFETY_CERTIFICATE: "Giấy chứng nhận PCCC (đối tác)",
};

const STATUS_META: Record<PartnerDocumentStatus, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Chưa nộp", color: "text-zinc-500", icon: ClockIcon },
  RECEIVED: { label: "Đang chờ xem xét", color: "text-amber-400", icon: ClockIcon },
  VERIFIED: { label: "Đã xác minh", color: "text-green-400", icon: CheckCircleIcon },
  REJECTED: { label: "Bị từ chối — cần nộp lại", color: "text-red-400", icon: XCircleIcon },
};

/** GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". §95.4: branch-level only (lease/
 * property doc, fire-safety cert, facility photos) — the partner-level documents (business
 * license, tax code, rep identity, already collected once at partner vetting) are shown
 * below as READ-ONLY context, never editable from here. Self-contained like StepPhotos. */
export function StepVerification({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["gym-branch-documents", gymId];
  const query = useQuery<{ documents: GymBranchDocument[]; partnerContext: PartnerDocumentContext[] }>({
    queryKey,
    queryFn: () => gymService.listBranchDocuments(gymId),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ docType, file }: { docType: BranchDocumentType; file: File }) => gymService.uploadBranchDocument(gymId, docType, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể tải tệp lên"),
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <CircleNotchIcon className="size-5 text-zinc-500 animate-spin" />
      </div>
    );
  }

  const documents = query.data?.documents ?? [];
  const partnerContext = query.data?.partnerContext ?? [];
  const byType = new Map(documents.map((d) => [d.docType, d]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Xác minh</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Giấy tờ riêng cho ĐỊA ĐIỂM này — không phải giấy tờ pháp nhân đối tác (đã nộp một lần khi thẩm định, xem bên dưới).
        </p>
      </div>

      <div className="space-y-3">
        {DOC_ORDER.map((docType) => {
          const doc = byType.get(docType);
          const meta = STATUS_META[doc?.status ?? "PENDING"];
          return (
            <DocumentRow
              key={docType}
              docType={docType}
              doc={doc}
              meta={meta}
              uploading={uploadMutation.isPending && uploadMutation.variables?.docType === docType}
              onUpload={(file) => uploadMutation.mutate({ docType, file })}
            />
          );
        })}
      </div>

      {partnerContext.length > 0 && (
        <div className="pt-4 border-t border-zinc-800">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Giấy tờ đối tác đã nộp (chỉ xem, không cần nộp lại)</p>
          <div className="space-y-1.5">
            {partnerContext.map((doc) => {
              const meta = STATUS_META[doc.status];
              return (
                <div key={doc.docType} className="flex items-center justify-between rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2">
                  <span className="text-xs text-zinc-400">{PARTNER_DOC_LABEL[doc.docType] ?? doc.docType}</span>
                  <span className={`flex items-center gap-1 text-xs font-semibold ${meta.color}`}>
                    <meta.icon className="size-3.5" /> {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  docType,
  doc,
  meta,
  uploading,
  onUpload,
}: {
  docType: BranchDocumentType;
  doc: GymBranchDocument | undefined;
  meta: { label: string; color: string; icon: React.ElementType };
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPdf = doc?.fileToken?.toLowerCase().endsWith(".pdf") ?? false;

  // Deliberately never revokes this object URL — it's handed to a new browser tab the user
  // may still be reading; revoking on this component's own lifecycle would pull the rug out
  // from under that tab. An occasional, owner-initiated action, not a hot path.
  async function openPdf() {
    if (!doc?.fileToken) return;
    try {
      const blob = await gymService.fetchBranchDocumentBlob(doc.fileToken);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch {
      toast.error("Không thể mở tệp");
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-200">{DOC_LABEL[docType]}</p>
          <span className={`flex items-center gap-1 text-xs font-medium mt-0.5 ${meta.color}`}>
            <meta.icon className="size-3.5" /> {meta.label}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {uploading ? <CircleNotchIcon className="size-3.5 animate-spin" /> : <UploadSimpleIcon className="size-3.5" />}
          {doc?.fileToken ? "Nộp lại" : "Tải lên"}
        </button>
      </div>

      {doc?.fileToken && (
        <div className="mt-2.5">
          {isPdf ? (
            <button
              type="button"
              onClick={openPdf}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <FileTextIcon className="size-4" /> Xem tệp PDF đã nộp
            </button>
          ) : (
            <AuthenticatedImage
              fetchBlob={() => gymService.fetchBranchDocumentBlob(doc.fileToken!)}
              alt={DOC_LABEL[docType]}
              className="w-24 h-24"
            />
          )}
        </div>
      )}
    </div>
  );
}
