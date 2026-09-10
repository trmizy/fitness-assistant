import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  WarningCircleIcon,
  ClockIcon,
  CheckCircleIcon,
  XIcon,
  UserIcon,
  BuildingsIcon,
} from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import type { ComplaintIssueType, ComplaintSource, ComplaintStatus, GymComplaint } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { AuthenticatedImage } from "../../components/ui/AuthenticatedImage";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";

export const ISSUE_TYPE_LABEL: Record<ComplaintIssueType, string> = {
  CLEANLINESS: "Vệ sinh",
  STAFF_BEHAVIOR: "Thái độ nhân viên",
  EQUIPMENT_CONDITION: "Thiết bị hư hỏng",
  FALSE_ADVERTISING: "Quảng cáo sai sự thật",
  BILLING: "Tính phí sai",
  SAFETY: "An toàn",
  OTHER: "Khác",
};

export const SOURCE_LABEL: Record<ComplaintSource, string> = {
  SELF_DETECTED: "Admin tự phát hiện",
  MEMBER_REPORT: "Hội viên báo cáo",
  PT_REPORT: "PT phản ánh",
  PARTNER_DISCLOSED: "Đối tác tự khai báo",
};

const STATUS_TABS: { key: ComplaintStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "Tất cả" },
  { key: "OPEN", label: "Mới" },
  { key: "IN_PROGRESS", label: "Đang xử lý" },
  { key: "RESOLVED", label: "Đã xử lý" },
];

export function statusMeta(status: ComplaintStatus) {
  if (status === "OPEN") return { label: "Mới", tone: "info" as const, icon: ClockIcon };
  if (status === "IN_PROGRESS") return { label: "Đang xử lý", tone: "warning" as const, icon: WarningCircleIcon };
  return { label: "Đã xử lý", tone: "success" as const, icon: CheckCircleIcon };
}

/**
 * GYM_MANAGEMENT master spec, Phase 5 — the "Khiếu nại" section of the admin nav that Phase
 * 3's IA restructuring deliberately left out ("adding a nav item with nowhere real to go
 * would be exactly the thing the spec forbids" — see GYM_MANAGEMENT_API_GAPS.md). One shared
 * queue regardless of source (SELF_DETECTED/MEMBER_REPORT/PT_REPORT/PARTNER_DISCLOSED).
 */
export function AdminComplaintsPage() {
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | "ALL">("OPEN");
  const [selected, setSelected] = useState<GymComplaint | null>(null);
  const queryClient = useQueryClient();

  const complaintsQuery = useQuery<GymComplaint[]>({
    queryKey: ["admin-complaints", statusFilter],
    queryFn: () => adminService.listComplaints(statusFilter === "ALL" ? undefined : statusFilter),
  });
  const gymsQuery = useQuery({ queryKey: ["admin-gyms-all"], queryFn: () => adminService.listGymsForAdmin() });
  const gymNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of gymsQuery.data ?? []) map.set(g.id, g.approvedName ?? g.name);
    return map;
  }, [gymsQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-complaints"] });

  if (complaintsQuery.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <PageSkeleton variant="list" rows={4} />
      </div>
    );
  }
  if (complaintsQuery.isError) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <ErrorState kind="server" onRetry={() => complaintsQuery.refetch()} />
      </div>
    );
  }

  const complaints = complaintsQuery.data ?? [];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader title="Khiếu nại / Vi phạm" description="Mọi nguồn — hội viên báo cáo, PT phản ánh, admin tự phát hiện — trong một hàng đợi." />

      <div className="flex gap-1.5 flex-wrap border-b border-zinc-800/60 pb-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              statusFilter === t.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {complaints.length === 0 ? (
        <EmptyState
          title={statusFilter === "OPEN" ? "Không có khiếu nại mới nào." : "Không có khiếu nại nào khớp bộ lọc."}
          tone={statusFilter === "OPEN" ? "positive" : "neutral"}
        />
      ) : (
        <div className="space-y-2">
          {complaints.map((c) => {
            const meta = statusMeta(c.status);
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className="w-full text-left bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-200">{ISSUE_TYPE_LABEL[c.issueType]}</span>
                      <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} />
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                      <BuildingsIcon className="size-3" /> {gymNameById.get(c.gymId) ?? c.gymId.slice(0, 8)}
                      <span className="mx-1">·</span>
                      {SOURCE_LABEL[c.source]}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2">{c.description}</p>
                  </div>
                  <span className="text-[11px] text-zinc-600 shrink-0">{new Date(c.createdAt).toLocaleDateString("vi-VN")}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ComplaintDetailDialog
          complaint={selected}
          gymName={gymNameById.get(selected.gymId)}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            invalidate();
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

export function ComplaintDetailDialog({
  complaint,
  gymName,
  onClose,
  onChanged,
}: {
  complaint: GymComplaint;
  gymName?: string;
  onClose: () => void;
  onChanged: (updated: GymComplaint) => void;
}) {
  const [response, setResponse] = useState(complaint.adminResponse ?? "");

  const updateMutation = useMutation({
    mutationFn: (status: ComplaintStatus) => adminService.updateComplaintStatus(complaint.id, { status, adminResponse: response }),
    onSuccess: (updated) => {
      toast.success("Đã cập nhật");
      onChanged(updated);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const meta = statusMeta(complaint.status);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-lg w-full bg-zinc-950 rounded-2xl border border-zinc-800 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 sticky top-0 bg-zinc-950">
          <h3 className="text-sm font-bold text-zinc-100">{ISSUE_TYPE_LABEL[complaint.issueType]}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} />
            <span className="text-zinc-500 flex items-center gap-1">
              <BuildingsIcon className="size-3.5" /> {gymName ?? complaint.gymId}
            </span>
            <span className="text-zinc-500 flex items-center gap-1">
              <UserIcon className="size-3.5" /> {SOURCE_LABEL[complaint.source]}
              {complaint.reporterUserId ? ` (${complaint.reporterUserId.slice(0, 8)})` : ""}
            </span>
          </div>

          <p className="text-sm text-zinc-300">{complaint.description}</p>

          {complaint.photoTokens.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {complaint.photoTokens.map((token) => (
                <AuthenticatedImage
                  key={token}
                  fetchBlob={() => adminService.fetchComplaintPhotoBlob(token)}
                  alt="Ảnh minh chứng"
                  className="size-20"
                />
              ))}
            </div>
          )}

          {complaint.status !== "RESOLVED" ? (
            <div className="space-y-2">
              <Textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Phản hồi (bắt buộc khi đánh dấu Đã xử lý — người báo cáo sẽ thấy nội dung này)"
                rows={3}
              />
              <div className="flex gap-2">
                {complaint.status === "OPEN" && (
                  <Button variant="outline" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate("IN_PROGRESS")}>
                    Bắt đầu xử lý
                  </Button>
                )}
                <Button disabled={!response.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate("RESOLVED")}>
                  Đánh dấu đã xử lý
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900 rounded-lg px-3 py-2.5 text-sm">
              <span className="text-zinc-500">Phản hồi đã gửi: </span>
              <span className="text-zinc-300">{complaint.adminResponse}</span>
              <p className="text-[11px] text-zinc-600 mt-1">
                Xử lý xong lúc {complaint.resolvedAt ? new Date(complaint.resolvedAt).toLocaleString("vi-VN") : "—"} — không có phúc thẩm.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
