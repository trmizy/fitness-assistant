import { useState } from "react";
import { MapTrifoldIcon as MapTrifold, PlusIcon as Plus, ClockIcon as Clock } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ptCoachService, type RoadmapPhaseType, type RoadmapCreatorRole } from "../../services/api";
import { PtRoadmapDraftModal } from "./PtRoadmapDraftModal";

const PHASE_TYPE_LABEL: Record<RoadmapPhaseType, string> = {
  FAT_LOSS: "Giảm mỡ",
  DIET_BREAK: "Nghỉ giữa kỳ",
  MAINTENANCE: "Duy trì",
  LEAN_GAIN: "Tăng cơ nạc",
  MINI_CUT: "Cắt ngắn",
  RECOMPOSITION: "Tái cấu trúc cơ thể",
  PERFORMANCE: "Hiệu suất",
  RECOVERY: "Hồi phục",
};

const CREATOR_ROLE_LABEL: Record<RoadmapCreatorRole, string> = {
  CLIENT: "Học viên tự tạo",
  PT: "Bạn đề xuất",
  AI: "AI đề xuất",
  SYSTEM: "Hệ thống tạo",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** FitnessRoadmap PT-assisted integration — mirrors
 * ClientFitnessSummaryCard.tsx's card/query pattern. GET
 * /coach/clients/:id/roadmap (gated by the same real, per-request
 * PT-client relationship check every other PT action already requires)
 * returns BOTH the client's ACTIVE roadmap and their pending DRAFT, so
 * this card never offers to create a redundant second draft when one is
 * already waiting on the client's own review. Read-only + a create entry
 * point only — never a way to activate/advance/rebuild/archive.
 * See docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md. */
export function ClientRoadmapCard({ clientUserId, clientName }: { clientUserId: string; clientName: string }) {
  const queryClient = useQueryClient();
  const [showDraftModal, setShowDraftModal] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pt-client-roadmap", clientUserId],
    queryFn: () => ptCoachService.getClientRoadmap(clientUserId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pt-client-roadmap", clientUserId] });

  const activeRoadmap = data?.activeRoadmap ?? null;
  const pendingDraft = data?.pendingDraft ?? null;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <MapTrifold className="h-4 w-4 text-green-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Lộ trình dài hạn</h4>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />
        </div>
      )}

      {isError && <p className="py-4 text-center text-xs text-zinc-500">Không thể tải dữ liệu lộ trình.</p>}

      {/* No ACTIVE roadmap and no pending DRAFT — the only state that offers
          a "create" CTA, so a PT can never accidentally spawn a redundant
          second draft (also protected server-side by the single-pending-
          draft policy, but this is the correct UX either way). */}
      {!isLoading && !isError && !activeRoadmap && !pendingDraft && (
        <div className="space-y-3 py-2 text-center">
          <p className="text-xs text-zinc-500">Học viên chưa có lộ trình dài hạn nào.</p>
          <button
            type="button"
            onClick={() => setShowDraftModal(true)}
            className="mx-auto flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-400 hover:bg-green-500/15"
          >
            <Plus className="h-3.5 w-3.5" /> Tạo lộ trình cho khách hàng
          </button>
        </div>
      )}

      {/* Pending DRAFT — no "Tạo lộ trình" CTA here at all (would create a
          redundant duplicate); just a clear read-only summary. */}
      {!isLoading && !isError && !activeRoadmap && pendingDraft && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
            <Clock className="h-4 w-4 flex-shrink-0 text-blue-400" />
            <p className="text-xs text-blue-200">Bản nháp đang chờ học viên — học viên chưa bắt đầu lộ trình này.</p>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Tên</span>
            <span className="text-zinc-300">{pendingDraft.roadmap.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Nguồn</span>
            <span className="text-zinc-300">{CREATOR_ROLE_LABEL[pendingDraft.roadmap.createdByRole]}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Số giai đoạn</span>
            <span className="text-zinc-300">{pendingDraft.phases.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Tạo lúc</span>
            <span className="text-zinc-300">{formatDate(pendingDraft.roadmap.createdAt)}</span>
          </div>
        </div>
      )}

      {/* ACTIVE roadmap — read-only, unchanged from before. */}
      {!isLoading && !isError && activeRoadmap && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Tên</span>
            <span className="text-zinc-300">{activeRoadmap.roadmap.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Trạng thái</span>
            <span className="font-semibold text-green-400">Đang thực hiện</span>
          </div>
          {activeRoadmap.activePhase && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Giai đoạn hiện tại</span>
              <span className="text-zinc-300">
                {activeRoadmap.activePhase.name} · {PHASE_TYPE_LABEL[activeRoadmap.activePhase.phaseType]}
              </span>
            </div>
          )}
          {activeRoadmap.pendingRebuild && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-300">
              Lộ trình đang chờ học viên xem xét đề xuất xây dựng lại.
            </p>
          )}

          {/* §10 — reuses the client's own derived readiness (Gymini
              Adaptive Cycle Transition Continuity phase); never a second
              forecast/readiness computation for the PT. */}
          {(activeRoadmap.trainingReadiness || activeRoadmap.nutritionReadiness) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {activeRoadmap.trainingReadiness && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                    activeRoadmap.trainingReadiness.status === "READY"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }`}
                >
                  Tập luyện: {activeRoadmap.trainingReadiness.status === "READY" ? "Sẵn sàng" : "Chưa có lịch tập"}
                </span>
              )}
              {activeRoadmap.nutritionReadiness && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                    activeRoadmap.nutritionReadiness.status === "READY"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }`}
                >
                  Dinh dưỡng: {activeRoadmap.nutritionReadiness.status === "READY" ? "Sẵn sàng" : "Chưa có mục tiêu"}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showDraftModal && (
        <PtRoadmapDraftModal
          clientUserId={clientUserId}
          clientName={clientName}
          onClose={() => setShowDraftModal(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}
