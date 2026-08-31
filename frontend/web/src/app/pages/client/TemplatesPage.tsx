import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Share2, Download, ArrowLeft, Loader2, Users } from "lucide-react";
import { useNavigate } from "react-router";
import { templateService, workoutService, contractService, type WorkoutProgramTemplate } from "../../services/api";

/**
 * Roadmap P2.6 "Workout template sharing/import"
 * (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md).
 *
 * PT<->client sharing only, reusing the real, already-active Contract
 * relationship (contractService) to populate who a template can be
 * shared with — never an open/public list.
 */

const WEEKDAYS = [
  { value: 1, label: "T2" }, { value: 2, label: "T3" }, { value: 3, label: "T4" },
  { value: 4, label: "T5" }, { value: 5, label: "T6" }, { value: 6, label: "T7" }, { value: 0, label: "CN" },
];

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [isCreating, setIsCreating] = useState(false);
  const [shareTargetId, setShareTargetId] = useState<string | null>(null);
  const [shareRecipient, setShareRecipient] = useState("");
  const [importTargetId, setImportTargetId] = useState<string | null>(null);
  const [importStartDate, setImportStartDate] = useState(toDateInputValue(new Date()));
  const [importWeekdays, setImportWeekdays] = useState<number[]>([new Date().getDay()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentProgramQuery = useQuery({ queryKey: ["current-program"], queryFn: () => workoutService.getCurrentProgram() });
  const mineQuery = useQuery({ queryKey: ["templates", "mine"], queryFn: () => templateService.listMine() });
  const sharedQuery = useQuery({ queryKey: ["templates", "shared"], queryFn: () => templateService.listSharedWithMe() });

  // Real, already-active PT<->client relationships only — never an open
  // list of every user in the system.
  const ptContractsQuery = useQuery({ queryKey: ["contracts", "pt", "active"], queryFn: () => contractService.getByPT("ACTIVE") });
  const clientContractsQuery = useQuery({ queryKey: ["contracts", "client", "active"], queryFn: () => contractService.getByClient("ACTIVE") });

  const shareableContacts = useMemo(() => {
    const fromClients = (ptContractsQuery.data ?? []).map((c: any) => ({
      userId: c.clientUserId,
      name: `${c.clientProfile?.firstName ?? ""} ${c.clientProfile?.lastName ?? ""}`.trim() || c.clientUserId,
    }));
    const fromPts = (clientContractsQuery.data ?? []).map((c: any) => ({
      userId: c.ptUserId,
      name: `${c.ptProfile?.firstName ?? ""} ${c.ptProfile?.lastName ?? ""}`.trim() || c.ptUserId,
    }));
    const merged = [...fromClients, ...fromPts];
    return merged.filter((p, i) => merged.findIndex((q) => q.userId === p.userId) === i);
  }, [ptContractsQuery.data, clientContractsQuery.data]);

  const handleCreateFromCurrentProgram = async () => {
    const program = currentProgramQuery.data;
    if (!program) return;
    setIsCreating(true);
    try {
      await templateService.createFromProgram({ programId: program.id });
      toast.success(`Đã tạo template từ "${program.name}".`);
      void queryClient.invalidateQueries({ queryKey: ["templates", "mine"] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể tạo template.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleShare = async (templateId: string) => {
    if (!shareRecipient) return;
    setIsSubmitting(true);
    try {
      await templateService.share(templateId, shareRecipient);
      toast.success("Đã chia sẻ template.");
      setShareTargetId(null);
      setShareRecipient("");
      void queryClient.invalidateQueries({ queryKey: ["templates", "mine"] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể chia sẻ template.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImport = async (templateId: string) => {
    if (importWeekdays.length === 0) {
      toast.error("Chọn ít nhất 1 ngày trong tuần.");
      return;
    }
    setIsSubmitting(true);
    try {
      await templateService.importTemplate(templateId, {
        startDate: importStartDate,
        selectedWeekdays: importWeekdays,
        replaceExisting: true,
      });
      toast.success("Đã nhập chương trình vào lịch tập của bạn.");
      setImportTargetId(null);
      void queryClient.invalidateQueries({ queryKey: ["current-program"] });
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể nhập template.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const mineTemplates = mineQuery.data?.templates ?? [];
  const sharedTemplates = sharedQuery.data?.templates ?? [];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <button type="button" onClick={() => navigate("/client/profile")} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại hồ sơ
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Share2 className="w-5 h-5 text-emerald-400" /> Template chương trình tập
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Chia sẻ chương trình tập với PT/học viên của bạn, hoặc nhập một template được chia sẻ.</p>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setTab("mine")} data-testid="templates-tab-mine" className={`px-3 py-1.5 rounded-lg text-xs border ${tab === "mine" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-zinc-700/40 text-zinc-400"}`}>
          Của tôi
        </button>
        <button type="button" onClick={() => setTab("shared")} data-testid="templates-tab-shared" className={`px-3 py-1.5 rounded-lg text-xs border ${tab === "shared" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-zinc-700/40 text-zinc-400"}`}>
          Được chia sẻ
        </button>
      </div>

      {tab === "mine" ? (
        <div className="space-y-3">
          <button
            type="button"
            data-testid="create-template-from-current-program-button"
            onClick={handleCreateFromCurrentProgram}
            disabled={!currentProgramQuery.data || isCreating}
            className="w-full rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {currentProgramQuery.data ? `Tạo template từ "${currentProgramQuery.data.name}"` : "Bạn chưa có chương trình đang hoạt động"}
          </button>

          {mineTemplates.map((t: WorkoutProgramTemplate) => (
            <div key={t.id} data-testid={`template-mine-${t.id}`} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-200">{t.name}</p>
                  <p className="text-[11px] text-zinc-500">{t.daysJson.length} ngày/tuần · Đã chia sẻ với {t.sharedWithUserIds.length} người</p>
                </div>
                <button
                  type="button"
                  data-testid={`share-template-button-${t.id}`}
                  onClick={() => setShareTargetId(shareTargetId === t.id ? null : t.id)}
                  className="px-3 py-1.5 rounded-lg border border-sky-500/30 text-sky-300 text-xs hover:bg-sky-500/10 flex items-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" /> Chia sẻ
                </button>
              </div>
              {shareTargetId === t.id && (
                <div className="flex gap-2 pt-1">
                  <select
                    data-testid="share-recipient-select"
                    value={shareRecipient}
                    onChange={(e) => setShareRecipient(e.target.value)}
                    className="flex-1 rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                  >
                    <option value="">Chọn người nhận...</option>
                    {shareableContacts.map((c) => (
                      <option key={c.userId} value={c.userId}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="confirm-share-button"
                    onClick={() => handleShare(t.id)}
                    disabled={!shareRecipient || isSubmitting}
                    className="px-3 py-1.5 rounded-lg bg-sky-500 text-black text-xs font-semibold disabled:opacity-40"
                  >
                    Xác nhận
                  </button>
                </div>
              )}
            </div>
          ))}
          {shareableContacts.length === 0 && !ptContractsQuery.isLoading && !clientContractsQuery.isLoading && (
            <p className="text-xs text-zinc-600 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Bạn chưa có PT/học viên nào đang hoạt động để chia sẻ.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sharedTemplates.length === 0 ? (
            <p className="text-xs text-zinc-600">Chưa có template nào được chia sẻ với bạn.</p>
          ) : (
            sharedTemplates.map((t: WorkoutProgramTemplate) => (
              <div key={t.id} data-testid={`template-shared-${t.id}`} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 space-y-2">
                <p className="text-sm text-zinc-200">{t.name}</p>
                <p className="text-[11px] text-zinc-500">{t.daysJson.length} ngày/tuần</p>
                <button
                  type="button"
                  data-testid={`import-template-button-${t.id}`}
                  onClick={() => setImportTargetId(importTargetId === t.id ? null : t.id)}
                  className="px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 text-xs hover:bg-emerald-500/10 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Nhập vào lịch của tôi
                </button>
                {importTargetId === t.id && (
                  <div className="space-y-2 pt-1">
                    <input
                      type="date"
                      data-testid="import-start-date-input"
                      value={importStartDate}
                      onChange={(e) => setImportStartDate(e.target.value)}
                      className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
                    />
                    <div className="flex gap-1.5 flex-wrap">
                      {WEEKDAYS.map((w) => (
                        <button
                          key={w.value}
                          type="button"
                          onClick={() =>
                            setImportWeekdays((prev) => (prev.includes(w.value) ? prev.filter((d) => d !== w.value) : [...prev, w.value]))
                          }
                          className={`px-2.5 py-1 rounded-lg border text-[11px] ${importWeekdays.includes(w.value) ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-zinc-700/40 text-zinc-500"}`}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      data-testid="confirm-import-button"
                      onClick={() => handleImport(t.id)}
                      disabled={isSubmitting}
                      className="w-full px-3 py-2 rounded-lg bg-emerald-500 text-black text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Xác nhận nhập
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
