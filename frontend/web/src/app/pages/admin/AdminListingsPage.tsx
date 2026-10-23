import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { PageHeader } from "../../components/ui/PageHeader";
import { adminAmenityService } from "../../services/ptListingApi";
import { AmenityCatalogTab } from "./listings/AmenityCatalogTab";
import { AmenityProposalsTab } from "./listings/AmenityProposalsTab";
import { RevisionDetail } from "./listings/RevisionDetail";
import { RevisionQueue } from "./listings/RevisionQueue";
import { TargetPicker } from "./listings/TargetPicker";
import { proposalsKey } from "./listings/adminListingShared";

type Tab = "pts" | "gyms" | "catalog" | "proposals";
const TABS: { key: Tab; label: string }[] = [
  { key: "pts", label: "Tin PT" },
  { key: "gyms", label: "Tin Gym" },
  { key: "catalog", label: "Danh mục tiện ích" },
  { key: "proposals", label: "Đề xuất tiện ích" },
];
const isTab = (v: string | null): v is Tab => v === "pts" || v === "gyms" || v === "catalog" || v === "proposals";

/**
 * "Tin đăng & tiện ích" — everything the admin moderates about what the public sees of a trainer or a branch,
 * on ONE page: the PT and Gym revision queues (drill into a revision for the diff / preview / history and the
 * decision), the amenity catalogue, and the amenity proposals gym owners made. The selected tab and revision live in
 * the URL (?tab=…&rid=…) so a notification link or a refresh lands in the same place.
 */
export function AdminListingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : "pts";
  const rid = params.get("rid");

  const setTab = (next: Tab) => setParams(next === "pts" ? {} : { tab: next }, { replace: false });
  const openRevision = (id: string) => setParams({ tab, rid: id });
  const closeRevision = () => setParams(tab === "pts" ? {} : { tab });

  // The badge on "Đề xuất tiện ích": same query the tab itself uses, so it costs nothing extra.
  const pendingProposals = useQuery({ queryKey: proposalsKey("PENDING"), queryFn: () => adminAmenityService.listProposals("PENDING"), staleTime: 30_000 });
  const pendingCount = pendingProposals.data?.length ?? 0;

  const inDetail = !!rid && (tab === "pts" || tab === "gyms");

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <PageHeader title="Tin đăng & tiện ích" description="Duyệt bản sửa tin đăng của huấn luyện viên và chi nhánh, quản lý danh mục tiện ích và đề xuất của chủ gym." />

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Các mục">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${tab === t.key ? "bg-green-500 text-black" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800/60"}`}
          >
            {t.label}
            {t.key === "proposals" && pendingCount > 0 && (
              <span className={`rounded-full px-1.5 text-[11px] font-bold ${tab === t.key ? "bg-black/20 text-black" : "bg-blue-500/20 text-blue-300"}`}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {inDetail ? (
        <RevisionDetail key={`${tab}:${rid}`} kind={tab === "pts" ? "pts" : "gyms"} rid={rid} onBack={closeRevision} onOpenProposals={() => setTab("proposals")} />
      ) : tab === "pts" || tab === "gyms" ? (
        <div className="space-y-4">
          <TargetPicker key={`picker-${tab}`} kind={tab} />
          <RevisionQueue key={tab} kind={tab} onOpen={openRevision} />
        </div>
      ) : tab === "catalog" ? (
        <AmenityCatalogTab />
      ) : (
        <AmenityProposalsTab />
      )}
    </div>
  );
}
