import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { CaretLeftIcon as ChevronLeft, ChatTextIcon as MessageSquare, CalendarIcon as Calendar, FileTextIcon as FileText, ClockIcon as Clock, CheckCircleIcon as CheckCircle, XCircleIcon as XCircle, WarningCircleIcon as AlertCircle, ClipboardTextIcon as ClipboardList } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { contractService, sessionService } from "../../services/api";
import { formatVND } from "../../utils/currency";
import { ClientFitnessSummaryCard } from "./ClientFitnessSummaryCard";
import { AssignPlanModal } from "./AssignPlanModal";

function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

function formatDate(d: string | null | undefined) {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("vi-VN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return "–";
  return new Date(d).toLocaleString("vi-VN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function SessionStatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    CONFIRMED: {
      label: "Đã xác nhận",
      cls: "bg-green-500/10 text-green-400 border-green-500/20",
      icon: <CheckCircle className="w-3 h-3" />,
    },
    REQUESTED: {
      label: "Đã yêu cầu",
      cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      icon: <Clock className="w-3 h-3" />,
    },
    COMPLETED: {
      label: "Hoàn thành",
      cls: "bg-zinc-700/60 text-zinc-400 border-zinc-600/40",
      icon: <CheckCircle className="w-3 h-3" />,
    },
    CANCELLED: {
      label: "Đã hủy",
      cls: "bg-red-500/10 text-red-400 border-red-500/20",
      icon: <XCircle className="w-3 h-3" />,
    },
    NO_SHOW: {
      label: "Vắng mặt",
      cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      icon: <AlertCircle className="w-3 h-3" />,
    },
  };
  const s = map[status] ?? {
    label: status,
    cls: "bg-zinc-800 text-zinc-500 border-zinc-700/60",
    icon: null,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border ${s.cls}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

const contractStatusLabel: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  PENDING_REVIEW: "Chờ duyệt",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

export function PTClientDetail() {
  const navigate = useNavigate();
  const { id: clientUserId } = useParams<{ id: string }>();
  const [showAssignPlan, setShowAssignPlan] = useState(false);

  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ["pt-contracts"],
    queryFn: () => contractService.getByPT(),
  });

  // Find the most recent active contract for this client
  const clientContracts = contracts
    .filter((c: any) => c.clientUserId === clientUserId)
    .sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const contract =
    clientContracts.find((c: any) => c.status === "ACTIVE") ??
    clientContracts[0];
  const clientName = contract?.clientName ?? "Học viên";

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["contract-sessions", contract?.id],
    queryFn: () => sessionService.getContractSessions(contract!.id),
    enabled: !!contract?.id,
  });

  const sessionsUsed = contract?.usedSessions ?? 0;
  const sessionsTotal = contract?.totalSessions ?? 0;
  const progressPct =
    sessionsTotal > 0
      ? Math.min(100, Math.round((sessionsUsed / sessionsTotal) * 100))
      : 0;

  const isLoading = contractsLoading;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <button
          onClick={() => navigate("/pt/clients")}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Tất cả học viên
        </button>
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <button
          onClick={() => navigate("/pt/clients")}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Tất cả học viên
        </button>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-12 text-center text-zinc-500 text-sm">
          Không tìm thấy học viên.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <button
        onClick={() => navigate("/pt/clients")}
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Tất cả học viên
      </button>

      {/* Client header */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-green-500/15 border border-green-500/20 rounded-2xl flex items-center justify-center text-xl font-bold text-green-400 flex-shrink-0 shadow-lg shadow-green-500/10">
              {getInitials(clientName)}
            </div>
            <div>
              <h1 className="text-zinc-100">{clientName}</h1>
              <div className="flex flex-wrap gap-2 mt-1.5">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    contract.status === "ACTIVE"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : contract.status === "PENDING_REVIEW"
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : "bg-zinc-700/60 text-zinc-400 border-zinc-600/40"
                  }`}
                >
                  Hợp đồng{" "}
                  {contractStatusLabel[contract.status] ?? contract.status}
                </span>
                <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
                  Buổi {sessionsUsed} / {sessionsTotal}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <button
              onClick={() => navigate("/pt/chat")}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700/60 text-zinc-300 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              <MessageSquare className="w-4 h-4" /> Chat
            </button>
            <button
              onClick={() => navigate("/pt/schedule")}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-sm font-medium hover:bg-blue-500/15 transition-colors"
            >
              <Calendar className="w-4 h-4" /> Đặt lịch
            </button>
            {contract.status === "ACTIVE" && (
              <button
                onClick={() => setShowAssignPlan(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-sm font-medium hover:bg-green-500/15 transition-colors"
              >
                <ClipboardList className="w-4 h-4" /> Giao kế hoạch
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sessions list */}
        <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200">Buổi tập</h4>
            <span className="text-xs text-zinc-500">
              {sessions.length} buổi
            </span>
          </div>
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-10 text-center text-zinc-500 text-sm">
              Chưa có buổi tập nào.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {[...sessions]
                .sort(
                  (a: any, b: any) =>
                    new Date(b.scheduledStartAt).getTime() -
                    new Date(a.scheduledStartAt).getTime(),
                )
                .map((s: any) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                        {formatDateTime(s.scheduledStartAt)}
                      </div>
                      {s.ptNotes && (
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                          {s.ptNotes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600 capitalize">
                        {s.sessionMode?.toLowerCase() ?? "–"}
                      </span>
                      <SessionStatusBadge status={s.status} />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Contract info */}
        <div className="space-y-4">
          {contract.status === "ACTIVE" && clientUserId && (
            <ClientFitnessSummaryCard clientUserId={clientUserId} />
          )}

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-green-400" />
              <h4 className="text-sm font-semibold text-zinc-200">Hợp đồng</h4>
            </div>
            <div className="space-y-2 text-sm">
              {[
                {
                  label: "Trạng thái",
                  value:
                    contractStatusLabel[contract.status] ?? contract.status,
                  valueClass:
                    contract.status === "ACTIVE"
                      ? "text-green-400 font-semibold"
                      : "text-zinc-400",
                },
                {
                  label: "Gói dịch vụ",
                  value: contract.packageName ?? "–",
                  valueClass: "text-zinc-300",
                },
                {
                  label: "Buổi tập",
                  value: `${sessionsUsed} / ${sessionsTotal}`,
                  valueClass: "text-zinc-300",
                },
                {
                  label: "Hết hạn",
                  value: formatDate(contract.endDate),
                  valueClass: "text-zinc-300",
                },
                ...(contract.price != null
                  ? [
                      {
                        label: "Giá",
                        value: formatVND(Number(contract.price)),
                        valueClass: "text-zinc-300",
                      },
                    ]
                  : []),
              ].map((r) => (
                <div key={r.label} className="flex justify-between">
                  <span className="text-zinc-500">{r.label}</span>
                  <span className={r.valueClass}>{r.value}</span>
                </div>
              ))}
            </div>
            {sessionsTotal > 0 && (
              <>
                <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.4)] transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="text-xs text-zinc-600 mt-1">
                  {sessionsTotal - sessionsUsed} buổi còn lại
                </div>
              </>
            )}
          </div>

          {/* Previous contracts */}
          {clientContracts.length > 1 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <h4 className="text-sm font-semibold text-zinc-200 mb-3">
                Lịch sử hợp đồng
              </h4>
              <div className="space-y-2">
                {clientContracts.slice(1).map((c: any) => (
                  <div key={c.id} className="flex justify-between text-xs">
                    <span className="text-zinc-500">
                      {c.packageName ?? "Package"}
                    </span>
                    <span className="text-zinc-600">
                      {contractStatusLabel[c.status] ?? c.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAssignPlan && clientUserId && (
        <AssignPlanModal
          clientUserId={clientUserId}
          clientName={clientName}
          onClose={() => setShowAssignPlan(false)}
        />
      )}
    </div>
  );
}
