import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleNotchIcon, MagnifyingGlassIcon, PencilSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { adminService } from "../../../services/api";
import { ptApplicationService } from "../../../services/ptApplicationService";
import { adminListingService } from "../../../services/ptListingApi";
import type { GymDirectEditSource, PtDirectEditSource } from "../../../types";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { listingErrorMessage } from "../../../utils/listingErrors";
import { eligibleGymTargets, eligiblePtTargets, filterTargets, type PickerTarget } from "../../../utils/listingPicker";
import { DirectEditDialog, gymSourceFromPublished, ptSourceFromPublished } from "./DirectEditDialog";
import type { ListingKind } from "./adminListingShared";

/**
 * "Chọn huấn luyện viên / chi nhánh để sửa": opens "Sửa trực tiếp" for any listing-eligible PT / branch, even one
 * that never sent a revision. The target lists are the existing admin ones (PT applications APPROVED, /admin/gyms);
 * the current published listing + version come from GET /admin/listings/{pts|gyms}/:id.
 */
export function TargetPicker({ kind }: { kind: ListingKind }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<PickerTarget | null>(null);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [source, setSource] = useState<PtDirectEditSource | GymDirectEditSource | null>(null);

  const listQuery = useQuery<PickerTarget[]>({
    queryKey: ["admin-listing-targets", kind],
    queryFn: async () =>
      kind === "pts"
        ? eligiblePtTargets(await ptApplicationService.listApplications({ status: "APPROVED" }))
        : eligibleGymTargets(await adminService.listGymsForAdmin()),
    staleTime: 60_000,
  });
  const results = useMemo(() => filterTargets(listQuery.data ?? [], q), [listQuery.data, q]);
  const noun = kind === "pts" ? "huấn luyện viên" : "chi nhánh";

  async function open(t: PickerTarget) {
    setTarget(t);
    setProblem(null);
    setOpening(true);
    try {
      if (kind === "pts") {
        setSource(ptSourceFromPublished(await queryClient.fetchQuery({ queryKey: ["admin-listing-published", "pts", t.id], queryFn: () => adminListingService.getPtPublished(t.id), staleTime: 0 })));
      } else {
        setSource(gymSourceFromPublished(await queryClient.fetchQuery({ queryKey: ["admin-listing-published", "gyms", t.id], queryFn: () => adminListingService.getGymPublished(t.id), staleTime: 0 })));
      }
    } catch (e) {
      setProblem(listingErrorMessage(e, "Không tải được tin đăng hiện tại."));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-zinc-800/70 bg-zinc-900 p-3">
      <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500" htmlFor={`target-${kind}`}>
        Chọn {noun} để sửa
      </label>
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
        <Input
          id={`target-${kind}`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setProblem(null);
          }}
          placeholder={kind === "pts" ? "Gõ tên hoặc email huấn luyện viên" : "Gõ tên chi nhánh, thương hiệu hoặc địa chỉ"}
          className="pl-8"
          autoComplete="off"
        />
      </div>

      {listQuery.isLoading && <p className="flex items-center gap-1.5 text-xs text-zinc-500"><CircleNotchIcon className="size-3.5 animate-spin" /> Đang tải danh sách…</p>}
      {listQuery.isError && <p className="text-xs text-red-400" role="alert">{listingErrorMessage(listQuery.error, "Không tải được danh sách.")}</p>}
      {q.trim() && !listQuery.isLoading && !listQuery.isError && results.length === 0 && <p className="text-xs text-zinc-500">Không có {noun} nào khớp.</p>}

      {results.length > 0 && (
        <ul className="divide-y divide-zinc-800/70 overflow-hidden rounded-lg border border-zinc-800/70">
          {results.map((t) => (
            <li key={t.id} className="flex items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-100">{t.title}</p>
                {t.subtitle && <p className="truncate text-xs text-zinc-500">{t.subtitle}</p>}
              </div>
              <Button size="sm" variant="outline" disabled={opening} onClick={() => void open(t)}>
                {opening && target?.id === t.id ? <CircleNotchIcon className="animate-spin" /> : <PencilSimpleIcon />} Sửa trực tiếp
              </Button>
            </li>
          ))}
        </ul>
      )}

      {problem && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200" role="alert">
          <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" /> {problem}
        </p>
      )}

      {source && (
        <DirectEditDialog
          kind={kind}
          source={source}
          onClose={() => {
            setSource(null);
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}
