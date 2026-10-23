import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { adminAmenityService } from "../../../services/ptListingApi";
import type { Amenity, AmenityCategory } from "../../../types";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorState } from "../../../components/ui/ErrorState";
import { PageSkeleton } from "../../../components/ui/PageSkeleton";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { AmenityIcon } from "../../../components/listing/AmenityIcon";
import { AmenityIconPicker } from "../../../components/listing/AmenityIconPicker";
import { ReasonDialog } from "../../../components/listing/ReasonDialog";
import { AMENITY_CATEGORIES, AMENITY_CATEGORY_LABEL, amenityCategoryLabel } from "../../../utils/amenityIcons";
import {
  amenityFormError,
  amenityFormFrom,
  buildAmenityCreateBody,
  buildAmenityPatchBody,
  groupAmenitiesByCategory,
  type AmenityForm,
} from "../../../utils/adminListing";
import { listingErrorMessage } from "../../../utils/listingErrors";
import { catalogueKey, handleAdminError, refreshAdminListings } from "./adminListingShared";

const selectCls =
  "h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] px-2 text-sm text-[var(--input-text)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const label = "block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5";

const EMPTY_FORM: AmenityForm = { name: "", category: "FACILITY", iconKey: "star", sortOrder: "" };

/** "Danh mục tiện ích": the catalogue every branch picks from. Create, rename, icon (allowlist), category, order, enable / disable. */
export function AmenityCatalogTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"" | "ACTIVE" | "DISABLED">("");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [editing, setEditing] = useState<Amenity | "new" | null>(null);
  const [disabling, setDisabling] = useState<Amenity | null>(null);

  const params = { ...(status ? { status } : {}), ...(submittedQ.trim() ? { q: submittedQ.trim() } : {}) };
  const query = useQuery({ queryKey: catalogueKey(params), queryFn: () => adminAmenityService.list(params), staleTime: 0 });

  const toggle = useMutation({
    mutationFn: ({ id, next, reason }: { id: string; next: "ACTIVE" | "DISABLED"; reason?: string }) =>
      adminAmenityService.update(id, { status: next, ...(reason ? { reason } : {}) }),
    onSuccess: (_a, v) => {
      toast.success(v.next === "ACTIVE" ? "Đã bật lại tiện ích." : "Đã tắt tiện ích — các bản nháp đang soạn đã được gỡ tiện ích này.");
      setDisabling(null);
      refreshAdminListings(queryClient);
    },
    onError: (e) => {
      setDisabling(null);
      handleAdminError(e, queryClient, "Không đổi được trạng thái tiện ích");
    },
  });

  const groups = groupAmenitiesByCategory(query.data?.amenities ?? [], AMENITY_CATEGORIES);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQ(q);
          }}
        >
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSubmittedQ(q)} placeholder="Tìm tiện ích theo tên" className="pl-8" aria-label="Tìm tiện ích" />
        </form>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Lọc theo trạng thái">
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Đang dùng</option>
          <option value="DISABLED">Đã tắt</option>
        </select>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon /> Tạo tiện ích
        </Button>
      </div>

      {query.isLoading ? (
        <PageSkeleton variant="list" rows={5} />
      ) : query.isError || !query.data ? (
        <ErrorState kind="server" message={listingErrorMessage(query.error, "Không tải được danh mục.")} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState title="Không có tiện ích nào khớp." description={submittedQ ? "Thử bỏ từ khóa hoặc đổi bộ lọc." : undefined} />
      ) : (
        groups.map((g) => (
          <section key={g.category} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{amenityCategoryLabel(g.category)}</h3>
            <ul className="divide-y divide-zinc-800/70 overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900">
              {g.items.map((a) => (
                <li key={a.id} className="flex items-center gap-3 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
                    <AmenityIcon iconKey={a.iconKey} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${a.status === "ACTIVE" ? "text-zinc-100" : "text-zinc-500"}`}>{a.name}</p>
                    <p className="text-xs text-zinc-500">
                      {a.source === "SYSTEM" ? "Có sẵn" : "Bổ sung"} · {a.gymCount ?? 0} chi nhánh đang dùng · thứ tự {a.sortOrder}
                    </p>
                  </div>
                  {a.status === "DISABLED" && <StatusBadge label="Đã tắt" tone="warning" />}
                  <Switch
                    checked={a.status === "ACTIVE"}
                    disabled={toggle.isPending}
                    aria-label={a.status === "ACTIVE" ? `Tắt ${a.name}` : `Bật ${a.name}`}
                    onCheckedChange={(on) => (on ? toggle.mutate({ id: a.id, next: "ACTIVE" }) : setDisabling(a))}
                  />
                  <Button size="sm" variant="outline" onClick={() => setEditing(a)} aria-label={`Sửa ${a.name}`}>
                    <PencilSimpleIcon />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {editing && <AmenityDialog amenity={editing === "new" ? null : editing} iconKeys={query.data?.iconKeys} onClose={() => setEditing(null)} />}

      <ReasonDialog
        open={disabling !== null}
        onOpenChange={(o) => !o && setDisabling(null)}
        title={`Tắt "${disabling?.name ?? ""}"?`}
        description="Tiện ích sẽ ẩn khỏi tin đăng công khai và bị gỡ khỏi mọi bản nháp đang soạn. Bản đang chờ duyệt được giữ nguyên (người duyệt sẽ thấy cảnh báo). Có thể bật lại bất cứ lúc nào."
        label="Lý do (không bắt buộc)"
        confirmLabel="Tắt tiện ích"
        danger
        validate={() => null}
        onConfirm={async (reason) => {
          if (disabling) await toggle.mutateAsync({ id: disabling.id, next: "DISABLED", reason }).catch(() => undefined);
        }}
      />
    </div>
  );
}

function AmenityDialog({ amenity, iconKeys, onClose }: { amenity: Amenity | null; iconKeys?: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AmenityForm>(amenity ? amenityFormFrom(amenity) : EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const error = amenityFormError(form, iconKeys);
  const set = (patch: Partial<AmenityForm>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      if (!amenity) return adminAmenityService.create(buildAmenityCreateBody(form));
      const body = buildAmenityPatchBody(amenity, form);
      if (!body) return amenity;
      return adminAmenityService.update(amenity.id, body);
    },
    onSuccess: () => {
      toast.success(amenity ? "Đã lưu tiện ích." : "Đã tạo tiện ích.");
      refreshAdminListings(queryClient);
      onClose();
    },
    onError: (e) => handleAdminError(e, queryClient, "Không lưu được tiện ích"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{amenity ? "Sửa tiện ích" : "Tạo tiện ích"}</DialogTitle>
          <DialogDescription>Tên không được trùng tiện ích khác (không tính dấu và chữ hoa). Đổi tên áp dụng cho mọi chi nhánh đang dùng.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={label} htmlFor="amenity-name">Tên tiện ích</label>
            <Input id="amenity-name" value={form.name} maxLength={50} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="amenity-category">Nhóm</label>
              <select id="amenity-category" className={selectCls} value={form.category} onChange={(e) => set({ category: e.target.value as AmenityCategory })}>
                {AMENITY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{AMENITY_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="amenity-sort">Thứ tự hiển thị</label>
              <Input id="amenity-sort" inputMode="numeric" placeholder="Tự động" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value.replace(/\D/g, "") })} />
            </div>
          </div>
          <div>
            <span className={label}>Biểu tượng</span>
            <AmenityIconPicker value={form.iconKey} keys={iconKeys} onChange={(iconKey) => set({ iconKey })} />
          </div>
          {touched && error && <p className="text-xs text-red-400" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>Hủy</Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!error) save.mutate();
            }}
          >
            {save.isPending && <CircleNotchIcon className="size-4 animate-spin" />}
            {amenity ? "Lưu" : "Tạo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
