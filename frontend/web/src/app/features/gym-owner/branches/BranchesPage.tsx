/**
 * "Chi nhánh" list (batch G2), behind VITE_GYM_OWNER_V2 (routes.tsx). Wraps the functions of the legacy MyGymsPage:
 * list of branches, resumable drafts, "Thêm chi nhánh" (wizard), first-run brand naming and brand rename (kept here in a compact
 * bar until the Thương hiệu page of G6), open a branch. Same services, same query keys, same mutations; only layout changed.
 *
 * Roles: OWNER everything; MANAGER reads the list (no add, no brand controls). RECEPTIONIST / ACCOUNTANT never reach it
 * (RequireStaffFeature `gyms`).
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BuildingsIcon, CaretRightIcon, CheckIcon, PencilSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Gym, GymBrand } from "../../../types";
import { ABOUT_MAX, AboutCounter } from "../../../components/gym/AboutCounter";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { TextStates } from "../../../components/layout/gym-owner/motion";
import { canViewBrands } from "../../../utils/gymStaffRole";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCode, branchCodes } from "../scope/scopeModel";
import { apiMessage, attentionItems, branchHref, tableBranches, tableRow, wizardHref, type AttentionItem } from "./branchesModel";

export function BranchesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useGymOwnerScope();
  const [params] = useSearchParams();
  const focusId = params.get("gymId");
  const role = scope.role;
  // Finding B (audit/02 section 5): only an explicit OWNER is an owner; a role that is still loading unlocks nothing.
  const isOwner = role === "OWNER";

  // Same keys as the legacy page and the scope provider: one cache entry per resource.
  const gymsQuery = useQuery<Gym[]>({ queryKey: ["owned-gyms"], queryFn: () => gymService.listOwnedGyms() });
  const brandsQuery = useQuery<GymBrand[]>({ queryKey: ["owned-brands"], queryFn: () => gymService.listOwnedBrands(), enabled: canViewBrands(role) });
  const gyms = gymsQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const isLoading = gymsQuery.isLoading || (canViewBrands(role) && brandsQuery.isLoading);
  const loadFailed = (gymsQuery.isError && !gymsQuery.data) || (brandsQuery.isError && !brandsQuery.data);

  // First-run brand setup: dismissible (X), not a hard block, exactly as before.
  const [brandPromptDismissed, setBrandPromptDismissed] = useState(false);
  const brandNameRef = useRef<HTMLInputElement>(null);
  const [brandForm, setBrandForm] = useState({ name: "", description: "" });
  const needsBrandSetup = isOwner && !isLoading && !loadFailed && brands.length === 0;

  const createBrandMutation = useMutation({
    mutationFn: () => gymService.createBrand(brandForm),
    onSuccess: () => {
      toast.success("Đã đặt tên thương hiệu — giờ có thể thêm chi nhánh đầu tiên");
      setBrandForm({ name: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Không thể tạo thương hiệu")),
  });
  // A rename only ever moves pendingName; approvedName (what is shown publicly) stays until Gymini approves it.
  const renameBrandMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => gymService.updateBrand(id, { name }),
    onSuccess: () => {
      toast.success("Đã lưu — tên mới sẽ hiển thị công khai sau khi Gymini duyệt");
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Không thể đổi tên")),
  });

  // N14G-05: "Thêm chi nhánh" opens the 7-step wizard directly (the draft saves itself, submit is the last step).
  const openAddBranch = () => (needsBrandSetup ? setBrandPromptDismissed(false) : navigate(wizardHref()));

  const rows = useMemo(() => tableBranches(gyms), [gyms]);
  const codes = useMemo(() => branchCodes(rows), [rows]);
  const attention = useMemo(() => attentionItems(gyms, role), [gyms, role]);

  return (
    <div className="go-wrap" data-testid="go-branches">
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-branches-title">Chi nhánh</h1>
          <p className="go-page-sub" data-testid="go-branches-sub">
            {isLoading ? "Đang tải danh sách chi nhánh" : loadFailed ? "Chưa tải được danh sách" : `${rows.length} chi nhánh${isOwner ? "" : " trong phạm vi của bạn"}`}
          </p>
        </div>
        {isOwner && (
          <button type="button" className="go-btn" data-variant="primary" onClick={openAddBranch} data-testid="go-branches-add">
            <PlusIcon aria-hidden="true" width={16} height={16} />
            Thêm chi nhánh
          </button>
        )}
      </header>

      {loadFailed && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-branches-error">
          <span>Không tải được danh sách chi nhánh. Chưa thể kết luận bạn có bao nhiêu chi nhánh.</span>
          <button
            type="button"
            className="go-btn go-btn-sm"
            onClick={() => {
              void gymsQuery.refetch();
              void brandsQuery.refetch();
            }}
          >
            Thử lại
          </button>
        </div>
      )}

      {brands.length > 0 && (
        <section className="go-brandbar" aria-label="Thương hiệu" data-testid="go-brandbar">
          {brands.map((b) => (
            <BrandRow
              key={b.id}
              brand={b}
              branchCount={gyms.filter((g) => g.brandId === b.id && g.status !== "DRAFT").length}
              isOwner={isOwner}
              pending={renameBrandMutation.isPending}
              onRename={(name) => renameBrandMutation.mutate({ id: b.id, name })}
            />
          ))}
        </section>
      )}

      {attention.length > 0 && (
        <section className="go-panel go-att" aria-labelledby="go-h-att" data-testid="go-branches-attention">
          <div className="go-panel-head">
            <h2 id="go-h-att">Cần bạn hoàn tất hoặc theo dõi</h2>
            <p>Bản nháp, hồ sơ đang chờ duyệt và yêu cầu chỉnh sửa từ Gymini</p>
          </div>
          <ul className="go-att-list">
            {attention.map((a) => (
              <AttentionRow key={`${a.kind}-${a.id}`} item={a} />
            ))}
          </ul>
        </section>
      )}

      <section className="go-panel go-btable-panel" aria-label="Danh sách chi nhánh">
        {isLoading && <TableSkeleton />}
        {!isLoading && !loadFailed && rows.length === 0 && (
          <div className="go-task-empty" data-testid="go-branches-empty">
            <strong>Chưa có chi nhánh nào</strong>
            <span>{isOwner ? "Hãy tạo chi nhánh đầu tiên để bắt đầu bán gói hội viên." : "Bạn chưa được giao chi nhánh nào."}</span>
          </div>
        )}
        {!isLoading && rows.length > 0 && (
          <div role="table" className="go-btable" aria-label="Chi nhánh" data-testid="go-branch-table">
            <div role="row" className="go-brow go-brow-head">
              <div role="columnheader">Chi nhánh</div>
              <div role="columnheader">Duyệt hồ sơ</div>
              <div role="columnheader">Vận hành</div>
              <div role="columnheader" className="go-num">Hội viên đang hoạt động</div>
              <div role="columnheader">Đánh giá</div>
            </div>
            {rows.map((g) => {
              const r = tableRow(g);
              const selected = focusId === g.id;
              return (
                <div key={g.id} role="row" className="go-brow" data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined} data-testid="go-branch-row" data-gym-id={g.id}>
                  <div role="cell" className="go-bcell-name">
                    <span className="go-code-chip" aria-hidden="true">{codes[g.id] ?? branchCode(g.name)}</span>
                    <div className="go-bcell-text">
                      <GoLink to={branchHref(g.id)} className="go-brow-link" aria-label={`Mở chi nhánh ${g.name}`}>
                        {r.name}
                      </GoLink>
                      <p className="go-brow-addr">{r.address}</p>
                      {r.suspensionReason && (
                        <p data-testid="gym-card-suspension-reason" className="go-brow-note">Lý do: {r.suspensionReason}</p>
                      )}
                    </div>
                    <span className="go-brow-chev" aria-hidden="true"><CaretRightIcon /></span>
                  </div>
                  <div role="cell" data-label="Duyệt hồ sơ"><GoTag tone={r.approval.tone} text={r.approval.text} /></div>
                  <div role="cell" data-label="Vận hành"><GoTag tone={r.operational.tone} text={r.operational.text} /></div>
                  <div role="cell" data-label="Hội viên đang hoạt động" className="go-num">{r.members === null ? "Chưa có" : r.members}</div>
                  <div role="cell" data-label="Đánh giá" className="go-rating">{r.rating ?? "Chưa có"}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <GoModal
        open={needsBrandSetup && !brandPromptDismissed}
        onClose={() => setBrandPromptDismissed(true)}
        closeOnBackdrop={false}
        initialFocusRef={brandNameRef}
        testId="brand-setup-modal"
        title="Đặt tên thương hiệu của bạn"
        description="Đây là tên khách sẽ thấy khi tìm kiếm. Mọi phòng gym bạn tạo sau này đều là một chi nhánh của thương hiệu này. Có thể đổi tên sau nếu cần."
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => setBrandPromptDismissed(true)}>Để sau</button>
            <button
              type="button"
              className="go-btn"
              data-variant="primary"
              onClick={() => createBrandMutation.mutate()}
              disabled={!brandForm.name.trim() || createBrandMutation.isPending}
            >
              <TextStates value={createBrandMutation.isPending ? "Đang lưu" : "Tiếp tục"} />
            </button>
          </>
        }
      >
        <div className="go-form">
          <label className="go-field">
            <span className="go-label">Tên thương hiệu</span>
            <input
              ref={brandNameRef}
              aria-label="Tên thương hiệu"
              className="go-input"
              value={brandForm.name}
              onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
              placeholder="Tên thương hiệu"
            />
          </label>
          <label className="go-field">
            <span className="go-label">Mô tả (tuỳ chọn)</span>
            <textarea
              aria-label="Mô tả thương hiệu"
              className="go-input go-textarea"
              value={brandForm.description}
              onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })}
              rows={3}
              maxLength={ABOUT_MAX}
              placeholder="Mô tả (tuỳ chọn)"
            />
            <AboutCounter value={brandForm.description} />
          </label>
        </div>
      </GoModal>
    </div>
  );
}

function BrandRow({ brand, branchCount, isOwner, pending, onRename }: { brand: GymBrand; branchCount: number; isOwner: boolean; pending: boolean; onRename: (name: string) => void }) {
  const displayName = brand.approvedName ?? brand.name;
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  return (
    <div className="go-brand-row">
      <BuildingsIcon aria-hidden="true" className="go-brand-ico" />
      <div className="go-brand-main">
        <div className="go-brand-line">
          {editing ? (
            <input
              data-testid="brand-rename-input"
              autoFocus
              aria-label="Tên thương hiệu mới"
              className="go-input go-input-sm"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          ) : (
            <strong className="go-brand-name">{displayName}</strong>
          )}
          <span className="go-brand-count">{branchCount} chi nhánh</span>
        </div>
        {brand.pendingName && (
          <p data-testid="brand-pending-approval-hint" className="go-brand-hint">
            Tên mới đang chờ Gymini duyệt: <strong>{brand.pendingName}</strong>
          </p>
        )}
      </div>
      {isOwner &&
        (editing ? (
          <div className="go-brand-actions">
            <button
              type="button"
              className="go-btn go-btn-sm"
              data-variant="primary"
              data-testid="brand-rename-save-button"
              onClick={() => {
                onRename(nameInput);
                setEditing(false);
              }}
              disabled={!nameInput.trim() || pending}
            >
              <CheckIcon aria-hidden="true" width={14} height={14} /> Lưu
            </button>
            <button type="button" className="go-btn go-btn-sm" onClick={() => setEditing(false)} aria-label="Huỷ đổi tên">
              <XIcon aria-hidden="true" width={14} height={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="go-btn go-btn-sm"
            data-testid="brand-rename-toggle"
            onClick={() => {
              setNameInput(displayName);
              setEditing(true);
            }}
          >
            <PencilSimpleIcon aria-hidden="true" width={14} height={14} /> Đổi tên
          </button>
        ))}
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li className="go-att-row" data-kind={item.kind} data-testid="go-branches-attention-row">
      <div className="go-att-main">
        <p className="go-att-name">{item.name}</p>
        <p className="go-att-text">{item.text}</p>
        {item.progress !== null && (
          <div className="go-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} aria-label={`Đã hoàn thành ${item.progress}%`}>
            <span style={{ width: `${item.progress}%` }} />
          </div>
        )}
      </div>
      {item.progress !== null && <span className="go-att-pct">{item.progress}% hoàn thành</span>}
      <GoLink to={item.href} className="go-btn go-btn-sm" data-variant={item.kind === "draft" ? "primary" : undefined}>
        {item.actionLabel}
      </GoLink>
    </li>
  );
}

function TableSkeleton() {
  return (
    <div className="go-task-skel" aria-hidden="true" data-testid="go-branches-skeleton">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="go-task-skel-row">
          <span className="go-skel-bar" style={{ width: "55%" }} />
          <span className="go-skel-bar" style={{ width: "35%" }} />
        </div>
      ))}
    </div>
  );
}
