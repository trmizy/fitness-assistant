import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowsMergeIcon, CaretDownIcon, CheckCircleIcon, CircleNotchIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { adminAmenityService, type ProposalDecisionResult } from "../../../services/ptListingApi";
import type { Amenity, AmenityCategory, AmenityProposalGroup } from "../../../types";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorState } from "../../../components/ui/ErrorState";
import { PageSkeleton } from "../../../components/ui/PageSkeleton";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { AmenityIcon } from "../../../components/listing/AmenityIcon";
import { AmenityIconPicker } from "../../../components/listing/AmenityIconPicker";
import { ReasonDialog } from "../../../components/listing/ReasonDialog";
import { AMENITY_CATEGORIES, AMENITY_CATEGORY_LABEL, amenityCategoryLabel } from "../../../utils/amenityIcons";
import {
  buildProposalApproveBody,
  buildProposalMergeBody,
  buildProposalRejectBody,
  dominantCategory,
  mergeTargets,
  ownerCountLabel,
  proposalOutcomeMessage,
  proposalRejectReasonError,
} from "../../../utils/adminListing";
import { listingErrorMessage, readAmenityExistsDisabled } from "../../../utils/listingErrors";
import { catalogueKey, handleAdminError, proposalsKey, refreshAdminListings } from "./adminListingShared";

const selectCls =
  "h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] px-2 text-sm text-[var(--input-text)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const label = "block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5";

const STATUS_TABS = [
  { value: "PENDING", label: "Chờ xử lý" },
  { value: "APPROVED", label: "Đã duyệt" },
  { value: "MERGED", label: "Đã gộp" },
  { value: "REJECTED", label: "Đã từ chối" },
] as const;

type Action = { kind: "approve" | "merge" | "reject"; group: AmenityProposalGroup };
/** 409 AMENITY_EXISTS_DISABLED: ask for the EXPLICIT "bật lại và gộp" (never done silently). */
type ExistsDisabled = { group: AmenityProposalGroup; via: "approve" | "merge"; amenity: { id: string; name: string } };

/**
 * "Đề xuất tiện ích": custom amenities gym owners asked for, grouped by (kind, name) so "3 chủ gym cùng đề xuất"
 * is one decision. Approve (category / icon / order, with defaults), reject (reason), merge into an existing
 * amenity — and the explicit "Bật lại và gộp" when the catalogue already has that name but switched off.
 */
export function AmenityProposalsTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("PENDING");
  const [action, setAction] = useState<Action | null>(null);
  const [existsDisabled, setExistsDisabled] = useState<ExistsDisabled | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery({ queryKey: proposalsKey(status), queryFn: () => adminAmenityService.listProposals(status), staleTime: 0 });
  const groups = query.data ?? [];

  const done = (res: ProposalDecisionResult) => {
    toast.success(proposalOutcomeMessage(res.outcome, res.amenity?.name));
    setAction(null);
    setExistsDisabled(null);
    refreshAdminListings(queryClient);
  };

  const decide = useMutation({
    mutationFn: async (v: { via: "approve" | "merge" | "reject"; group: AmenityProposalGroup; body: Record<string, unknown> }) =>
      v.via === "approve" ? adminAmenityService.approve(v.body) : v.via === "merge" ? adminAmenityService.merge(v.body) : adminAmenityService.reject(v.body),
    onSuccess: done,
    onError: (e, v) => {
      const disabled = readAmenityExistsDisabled(e);
      if (disabled && v.via !== "reject") {
        const target = v.via === "merge" ? { id: String(v.body.targetAmenityId ?? ""), name: disabled.name } : disabled;
        setAction(null);
        setExistsDisabled({ group: v.group, via: v.via, amenity: { id: disabled.id || target.id, name: disabled.name || target.name } });
        return;
      }
      setAction(null);
      setExistsDisabled(null);
      handleAdminError(e, queryClient, "Không xử lý được đề xuất");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800/60 pb-2" role="tablist">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={status === t.value}
            onClick={() => setStatus(t.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${status === t.value ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <PageSkeleton variant="list" rows={3} />
      ) : query.isError ? (
        <ErrorState kind="server" message={listingErrorMessage(query.error, "Không tải được đề xuất.")} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState tone={status === "PENDING" ? "positive" : "neutral"} title={status === "PENDING" ? "Không có đề xuất tiện ích nào đang chờ." : "Chưa có đề xuất nào ở mục này."} />
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const isOpen = open === g.key;
            const cats = Object.entries(g.suggestedCategories);
            return (
              <li key={g.key} className="space-y-3 rounded-xl border border-zinc-800/60 bg-zinc-900 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100">{g.name}</h3>
                  <StatusBadge label={g.kind === "REENABLE" ? "Yêu cầu bật lại" : "Đề xuất mới"} tone={g.kind === "REENABLE" ? "warning" : "info"} />
                  <span className="text-xs text-zinc-400">{ownerCountLabel(g.ownerCount)}</span>
                </div>

                {g.kind === "NEW" && cats.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    Nhóm được gợi ý: {cats.map(([c, n]) => `${amenityCategoryLabel(c)} (${n})`).join(", ")}
                  </p>
                )}
                {g.existingAmenity && (
                  <p className={`flex items-start gap-1.5 rounded-lg border p-2 text-xs ${g.existingAmenity.status === "ACTIVE" ? "border-blue-500/30 bg-blue-500/10 text-blue-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
                    <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                    {g.existingAmenity.status === "ACTIVE"
                      ? `Danh mục đã có "${g.existingAmenity.name}" — duyệt sẽ tự gộp vào tiện ích này.`
                      : `Danh mục có "${g.existingAmenity.name}" nhưng đang bị tắt — cần chọn rõ "Bật lại và gộp".`}
                  </p>
                )}

                <button type="button" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.key)}>
                  <CaretDownIcon className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} /> Chi tiết {g.proposals.length} đề xuất
                </button>
                {isOpen && (
                  <ul className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800/70">
                    {g.proposals.map((p) => (
                      <li key={p.id} className="px-3 py-2 text-xs">
                        <p className="text-zinc-200">{p.gymName ?? "Chi nhánh"} · {amenityCategoryLabel(p.suggestedCategory)}</p>
                        {p.note && <p className="text-zinc-500">"{p.note}"</p>}
                        {p.rejectReason && <p className="text-red-300">Lý do từ chối: {p.rejectReason}</p>}
                      </li>
                    ))}
                  </ul>
                )}

                {status === "PENDING" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={decide.isPending} onClick={() => setAction({ kind: "approve", group: g })}>
                      <CheckCircleIcon /> {g.kind === "REENABLE" ? "Bật lại tiện ích" : "Duyệt"}
                    </Button>
                    {g.kind === "NEW" && (
                      <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setAction({ kind: "merge", group: g })}>
                        <ArrowsMergeIcon /> Gộp vào tiện ích có sẵn
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="text-red-400" disabled={decide.isPending} onClick={() => setAction({ kind: "reject", group: g })}>
                      <XCircleIcon /> Từ chối
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {action?.kind === "approve" && (
        <ApproveDialog
          group={action.group}
          pending={decide.isPending}
          onClose={() => setAction(null)}
          onConfirm={(form) => decide.mutate({ via: "approve", group: action.group, body: buildProposalApproveBody(action.group, form) })}
        />
      )}
      {action?.kind === "merge" && (
        <MergeDialog
          group={action.group}
          pending={decide.isPending}
          onClose={() => setAction(null)}
          onConfirm={(targetId) => decide.mutate({ via: "merge", group: action.group, body: buildProposalMergeBody(action.group, targetId) })}
        />
      )}
      <ReasonDialog
        open={action?.kind === "reject"}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Từ chối đề xuất "${action?.group.name ?? ""}"?`}
        description="Tiện ích tùy chỉnh này sẽ bị gỡ khỏi các bản sửa đang mở của chủ gym, và họ nhận được lý do của bạn."
        label="Lý do từ chối (bắt buộc)"
        confirmLabel="Từ chối"
        danger
        validate={proposalRejectReasonError}
        onConfirm={async (reason) => {
          if (action?.kind === "reject") await decide.mutateAsync({ via: "reject", group: action.group, body: buildProposalRejectBody(action.group, reason) }).catch(() => undefined);
        }}
      />

      <Dialog open={existsDisabled !== null} onOpenChange={(o) => !o && !decide.isPending && setExistsDisabled(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tiện ích này đã có nhưng đang tắt</DialogTitle>
            <DialogDescription>
              Danh mục đã có tiện ích "{existsDisabled?.amenity.name}" nhưng đang bị tắt. Hệ thống không tự bật lại. Bạn muốn bật lại tiện ích đó cho toàn hệ thống rồi gộp đề xuất vào, hay từ chối đề xuất?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={decide.isPending} onClick={() => setExistsDisabled(null)}>Để sau</Button>
            <Button
              variant="outline"
              className="text-red-400"
              disabled={decide.isPending}
              onClick={() => {
                if (existsDisabled) setAction({ kind: "reject", group: existsDisabled.group });
                setExistsDisabled(null);
              }}
            >
              Từ chối đề xuất
            </Button>
            <Button
              disabled={decide.isPending}
              onClick={() => {
                if (!existsDisabled) return;
                const { group, via, amenity } = existsDisabled;
                // approve → the server finds the disabled twin itself; merge → name the target. Both carry the explicit flag.
                const body =
                  via === "approve"
                    ? buildProposalApproveBody(group, { category: (dominantCategory(group) ?? "FACILITY") as AmenityCategory, iconKey: "", sortOrder: "" }, { reenableAndMerge: true })
                    : buildProposalMergeBody(group, amenity.id, { reenableAndMerge: true });
                decide.mutate({ via, group, body });
              }}
            >
              {decide.isPending && <CircleNotchIcon className="size-4 animate-spin" />}
              Bật lại và gộp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApproveDialog({ group, pending, onClose, onConfirm }: { group: AmenityProposalGroup; pending: boolean; onClose: () => void; onConfirm: (form: { category: AmenityCategory; iconKey: string; sortOrder: string }) => void }) {
  const iconsQuery = useQuery({ queryKey: catalogueKey("icons"), queryFn: () => adminAmenityService.list({ status: "ACTIVE" }), staleTime: 5 * 60_000, enabled: group.kind === "NEW" });
  const [category, setCategory] = useState<AmenityCategory>(dominantCategory(group) ?? "FACILITY");
  const [iconKey, setIconKey] = useState("");
  const [sortOrder, setSortOrder] = useState("");

  if (group.kind === "REENABLE") {
    return (
      <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bật lại "{group.name}"?</DialogTitle>
            <DialogDescription>Tiện ích sẽ bật lại cho toàn hệ thống (mọi chi nhánh có thể chọn lại). Các bản sửa đang mở có đề xuất này được cập nhật tự động.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
            <Button disabled={pending} onClick={() => onConfirm({ category, iconKey: "", sortOrder: "" })}>
              {pending && <CircleNotchIcon className="size-4 animate-spin" />} Bật lại
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Duyệt "{group.name}"</DialogTitle>
          <DialogDescription>Tiện ích được thêm vào danh mục và tự gắn vào các bản sửa đang mở của {group.ownerCount} chủ gym đã đề xuất.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="approve-category">Nhóm</label>
              <select id="approve-category" className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as AmenityCategory)}>
                {AMENITY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{AMENITY_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="approve-sort">Thứ tự hiển thị</label>
              <Input id="approve-sort" inputMode="numeric" placeholder="Tự động" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Biểu tượng</span>
              <button type="button" className={`text-xs ${iconKey === "" ? "text-green-300" : "text-zinc-400 underline"}`} onClick={() => setIconKey("")}>
                {iconKey === "" ? "Mặc định theo nhóm" : "Dùng mặc định theo nhóm"}
              </button>
            </div>
            <AmenityIconPicker value={iconKey} keys={iconsQuery.data?.iconKeys} onChange={setIconKey} />
            {iconKey !== "" && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
                Đã chọn: <AmenityIcon iconKey={iconKey} className="size-4" />
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
          <Button disabled={pending} onClick={() => onConfirm({ category, iconKey, sortOrder })}>
            {pending && <CircleNotchIcon className="size-4 animate-spin" />} Duyệt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({ group, pending, onClose, onConfirm }: { group: AmenityProposalGroup; pending: boolean; onClose: () => void; onConfirm: (targetId: string) => void }) {
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const query = useQuery({ queryKey: catalogueKey("merge"), queryFn: () => adminAmenityService.list({}), staleTime: 30_000 });
  const list: Amenity[] = mergeTargets(query.data?.amenities ?? []).filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gộp "{group.name}" vào tiện ích có sẵn</DialogTitle>
          <DialogDescription>Các bản sửa đang mở sẽ dùng tiện ích bạn chọn thay cho đề xuất này.</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tiện ích trong danh mục" aria-label="Tìm tiện ích" />
        {query.isLoading ? (
          <PageSkeleton variant="list" rows={3} />
        ) : (
          <ul role="radiogroup" aria-label="Tiện ích đích" className="max-h-64 divide-y divide-zinc-800/70 overflow-y-auto rounded-lg border border-zinc-800/70">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={target === a.id}
                  onClick={() => setTarget(a.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${target === a.id ? "bg-green-500/10 text-green-300" : "text-zinc-200 hover:bg-zinc-800/50"}`}
                >
                  <AmenityIcon iconKey={a.iconKey} className="size-4" />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-zinc-500">{amenityCategoryLabel(a.category)}</span>
                  {a.status === "DISABLED" && <StatusBadge label="Đã tắt" tone="warning" />}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="p-3 text-sm text-zinc-500">Không có tiện ích nào khớp.</li>}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
          <Button disabled={pending || !target} onClick={() => onConfirm(target)}>
            {pending && <CircleNotchIcon className="size-4 animate-spin" />} Gộp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
