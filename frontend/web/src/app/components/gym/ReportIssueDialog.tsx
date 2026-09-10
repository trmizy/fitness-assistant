import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { XIcon, ImageIcon, CircleNotchIcon, ClockIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import type { ComplaintIssueType, ComplaintStatus, GymComplaint } from "../../types";
import { AuthenticatedImage } from "../ui/AuthenticatedImage";

const ISSUE_TYPE_LABEL: Record<ComplaintIssueType, string> = {
  CLEANLINESS: "Vệ sinh",
  STAFF_BEHAVIOR: "Thái độ nhân viên",
  EQUIPMENT_CONDITION: "Thiết bị hư hỏng",
  FALSE_ADVERTISING: "Quảng cáo sai sự thật",
  BILLING: "Tính phí sai",
  SAFETY: "An toàn",
  OTHER: "Khác",
};

const STATUS_META: Record<ComplaintStatus, { label: string; cls: string; icon: typeof ClockIcon }> = {
  OPEN: { label: "Mới gửi", cls: "bg-blue-500/10 border-blue-500/20 text-blue-400", icon: ClockIcon },
  IN_PROGRESS: { label: "Đang xử lý", cls: "bg-amber-500/10 border-amber-500/20 text-amber-400", icon: WarningCircleIcon },
  RESOLVED: { label: "Đã xử lý", cls: "bg-green-500/10 border-green-500/20 text-green-400", icon: CheckCircleIcon },
};

const MAX_PHOTOS = 5;

/**
 * GYM_MANAGEMENT master spec, Phase 5 — "Báo cáo vấn đề". Two tabs: compose a new report,
 * or see past reports (and admin's response) for THIS gym — deliberately scoped per-gym
 * rather than a separate global page, since the button that opens this already knows which
 * gym it's about. Distinct from reviews: private, no star rating, evidence photos never
 * shown publicly (only the reporter and admin can ever fetch them, via AuthenticatedImage).
 */
export function ReportIssueDialog({ gymId, gymName, onClose }: { gymId: string; gymName?: string; onClose: () => void }) {
  const [tab, setTab] = useState<"compose" | "history">("compose");
  const [issueType, setIssueType] = useState<ComplaintIssueType>("CLEANLINESS");
  const [description, setDescription] = useState("");
  const [photoTokens, setPhotoTokens] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const historyQuery = useQuery<GymComplaint[]>({
    queryKey: ["my-complaints"],
    queryFn: () => gymService.listMyComplaints(),
    enabled: tab === "history",
  });
  const myReportsForGym = (historyQuery.data ?? []).filter((c) => c.gymId === gymId);

  const submitMutation = useMutation({
    mutationFn: () => gymService.submitGymComplaint(gymId, { issueType, description, photoTokens }),
    onSuccess: () => {
      toast.success("Đã gửi báo cáo — Gymini sẽ xem xét sớm");
      queryClient.invalidateQueries({ queryKey: ["my-complaints"] });
      setDescription("");
      setPhotoTokens([]);
      setTab("history");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể gửi báo cáo"),
  });

  async function handleAddPhoto(file: File) {
    if (photoTokens.length >= MAX_PHOTOS) return;
    setUploading(true);
    try {
      const { token } = await gymService.uploadComplaintPhoto(file);
      setPhotoTokens((prev) => [...prev, token]);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Tải ảnh thất bại");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-zinc-950 sm:rounded-2xl rounded-t-2xl border border-zinc-800 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 sticky top-0 bg-zinc-950">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">Báo cáo vấn đề</h3>
            <p className="text-xs text-zinc-500">{gymName ?? `Chi nhánh #${gymId.slice(0, 8)}`}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          <button
            onClick={() => setTab("compose")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === "compose" ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"}`}
          >
            Gửi mới
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === "history" ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"}`}
          >
            Báo cáo của tôi
          </button>
        </div>

        {tab === "compose" && (
          <div className="p-4 space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Loại vấn đề</label>
              <select
                aria-label="Loại vấn đề"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as ComplaintIssueType)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
              >
                {(Object.keys(ISSUE_TYPE_LABEL) as ComplaintIssueType[]).map((t) => (
                  <option key={t} value={t}>
                    {ISSUE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Mô tả</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Mô tả chi tiết vấn đề bạn gặp phải…"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Ảnh minh chứng (tối đa {MAX_PHOTOS}, chỉ Gymini xem được)</label>
              <div className="flex flex-wrap gap-2">
                {photoTokens.map((token) => (
                  <div key={token} className="relative">
                    <AuthenticatedImage
                      fetchBlob={() => gymService.fetchComplaintPhotoBlob(token)}
                      alt="Ảnh minh chứng"
                      className="size-16"
                    />
                    <button
                      onClick={() => setPhotoTokens((prev) => prev.filter((t) => t !== token))}
                      className="absolute -top-1.5 -right-1.5 size-5 bg-red-500 rounded-full flex items-center justify-center text-white"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
                {photoTokens.length < MAX_PHOTOS && (
                  <label className="size-16 rounded-lg border border-dashed border-zinc-700 flex items-center justify-center text-zinc-500 hover:border-green-500/40 hover:text-green-400 cursor-pointer">
                    {uploading ? <CircleNotchIcon className="size-4 animate-spin" /> : <ImageIcon className="size-5" />}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleAddPhoto(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <button
              onClick={() => submitMutation.mutate()}
              disabled={!description.trim() || submitMutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {submitMutation.isPending && <CircleNotchIcon className="size-4 animate-spin" />}
              Gửi báo cáo
            </button>
          </div>
        )}

        {tab === "history" && (
          <div className="p-4 space-y-2">
            {historyQuery.isLoading ? (
              <CircleNotchIcon className="size-5 text-green-500 animate-spin mx-auto" />
            ) : myReportsForGym.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">Bạn chưa gửi báo cáo nào cho chi nhánh này.</p>
            ) : (
              myReportsForGym.map((c) => {
                const meta = STATUS_META[c.status];
                return (
                  <div key={c.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-300">{ISSUE_TYPE_LABEL[c.issueType]}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.cls}`}>
                        <meta.icon className="size-3" /> {meta.label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">{c.description}</p>
                    {c.photoTokens.length > 0 && (
                      <div className="flex gap-1.5">
                        {c.photoTokens.map((token) => (
                          <AuthenticatedImage key={token} fetchBlob={() => gymService.fetchComplaintPhotoBlob(token)} alt="Ảnh minh chứng" className="size-10" />
                        ))}
                      </div>
                    )}
                    {c.adminResponse && (
                      <div className="bg-zinc-800/60 rounded-lg px-2.5 py-2 text-xs">
                        <span className="text-zinc-500">Phản hồi từ Gymini: </span>
                        <span className="text-zinc-300">{c.adminResponse}</span>
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-600">{new Date(c.createdAt).toLocaleDateString("vi-VN")}</p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
