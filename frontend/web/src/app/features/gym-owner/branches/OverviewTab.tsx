/**
 * Tab "Tổng quan" of the branch detail (batch G2). Reuses what the legacy GymManagePage "Cài đặt" panel did, with the same
 * handlers (useUpdateGym = gymService.updateGym), the same fields/payload shapes and the same data-testids:
 *   - name + address (pending until Gymini approves), description (DRAFT only) + phone + email, location + note, brand (read-only);
 *   - check-in QR panel (existing GymCheckinPanel), wallet block (WalletBlock), members of the branch, links to plans / PT partners.
 * `?settings=1` opens the tab already in edit mode. MANAGER gets the same information read-only, with the reason (no write
 * button that would only come back as 403).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockSimpleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Gym, GymBrand } from "../../../types";
import { ABOUT_MAX, AboutCounter } from "../../../components/gym/AboutCounter";
import { GymCheckinPanel } from "../../../components/gym/GymCheckinPanel";
import { GymLocationFields, type GymLocationValue } from "../../../components/gym/GymLocationFields";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { TextStates } from "../../../components/layout/gym-owner/motion";
import { canUseFeature, type PartnerRole } from "../../../utils/gymStaffRole";
import { addressLine, walletAccessFor, type TabAccess } from "./branchesModel";
import { useUpdateGym } from "./useBranchMutations";
import { WalletBlock } from "./WalletBlock";

function Approval({ children }: { children: React.ReactNode }) {
  return <span className="go-badge" data-tone="info">{children}</span>;
}

export function OverviewTab({ gym, role, access, startEditing }: { gym: Gym; role: PartnerRole | undefined; access: TabAccess; startEditing: boolean }) {
  const id = gym.id;
  const canEdit = access === "edit";
  const [editing, setEditing] = useState(startEditing && canEdit);
  const update = useUpdateGym(id);

  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editLocation, setEditLocation] = useState<GymLocationValue>({ provinceCode: null, wardCode: null, latitude: null, longitude: null });
  const [editLocationNote, setEditLocationNote] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // Same hydration rule as the legacy page: the form follows the server copy of the branch.
  useEffect(() => {
    setEditName(gym.name);
    setEditAddress(gym.address);
    setEditLocation({ provinceCode: gym.provinceCode ?? null, wardCode: gym.wardCode ?? null, latitude: gym.latitude ?? null, longitude: gym.longitude ?? null });
    setEditLocationNote(gym.locationNote ?? "");
    setEditDescription(gym.description ?? "");
    setEditPhone(gym.phone ?? "");
    setEditEmail(gym.email ?? "");
  }, [gym.description, gym.phone, gym.email, gym.id, gym.name, gym.address, gym.provinceCode, gym.wardCode, gym.latitude, gym.longitude, gym.locationNote]);

  const { data: ownedBrands = [] } = useQuery<GymBrand[]>({ queryKey: ["owned-brands"], queryFn: () => gymService.listOwnedBrands() });
  const wallet = walletAccessFor(role);
  const brandName = ownedBrands[0] ? (ownedBrands[0].approvedName ?? ownedBrands[0].name) : "Chưa thiết lập thương hiệu";
  const isDraft = gym.status === "DRAFT";

  return (
    <div className="go-stack" data-testid="go-branch-overview">
      <section className="go-card" aria-labelledby="go-h-info">
        <div className="go-card-head">
          <h2 id="go-h-info">Thông tin chi nhánh</h2>
          {canEdit ? (
            <button type="button" className="go-btn go-btn-sm" data-testid="gym-settings-toggle" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
              <PencilSimpleIcon aria-hidden="true" width={14} height={14} />
              <TextStates value={editing ? "Xong" : "Chỉnh sửa"} />
            </button>
          ) : (
            <span className="go-lock" data-testid="go-readonly-reason"><LockSimpleIcon aria-hidden="true" width={14} height={14} /> Chỉ xem</span>
          )}
        </div>

        {!canEdit && <p className="go-card-note">Chỉ chủ phòng tập sửa được thông tin chi nhánh. Quản lý chỉ xem.</p>}

        {!editing && (
          <dl className="go-dl" data-testid="go-branch-info">
            <div><dt>Tên chi nhánh</dt><dd>{gym.name}</dd></div>
            <div><dt>Địa chỉ</dt><dd>{addressLine(gym)}</dd></div>
            <div><dt>Thương hiệu</dt><dd>{brandName}</dd></div>
            <div>
              <dt>Giới thiệu</dt>
              <dd data-testid="gym-description-readonly" className="go-prewrap">{gym.description?.trim() || <span className="go-muted">Chưa có phần giới thiệu.</span>}</dd>
            </div>
            <div><dt>Điện thoại</dt><dd>{gym.phone?.trim() || <span className="go-muted">Chưa có</span>}</dd></div>
            <div><dt>Email</dt><dd>{gym.email?.trim() || <span className="go-muted">Chưa có</span>}</dd></div>
            <div>
              <dt>Vị trí</dt>
              <dd>
                {gym.latitude != null && gym.longitude != null ? "Đã ghim vị trí trên bản đồ" : <span className="go-muted">Chưa ghim vị trí</span>}
                {gym.locationNote ? <span className="go-dd-sub">Hướng dẫn: {gym.locationNote}</span> : null}
              </dd>
            </div>
          </dl>
        )}

        {editing && canEdit && (
          <div className="go-form-sections" data-testid="gym-settings-panel">
            <div className="go-form-section">
              <div className="go-form-title">
                <h3>Tên và địa chỉ</h3>
                <Approval>Cần Gymini duyệt</Approval>
              </div>
              <p className="go-muted-text">Đổi tên hoặc địa chỉ ở đây chưa hiển thị công khai ngay, phải chờ Gymini duyệt. Trong lúc chờ, chi nhánh vẫn bán gói và cho check-in bình thường.</p>
              <input data-testid="gym-edit-name-input" aria-label="Tên chi nhánh" className="go-input" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <input data-testid="gym-edit-address-input" aria-label="Địa chỉ chi nhánh" className="go-input" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
              <div className="go-form-actions">
                <button
                  type="button"
                  className="go-btn go-btn-sm"
                  data-variant="primary"
                  data-testid="gym-save-name-address-button"
                  onClick={() => update.mutate({ name: editName, address: editAddress })}
                  disabled={!editName.trim() || !editAddress.trim() || update.isPending}
                >
                  <TextStates value={update.isPending ? "Đang lưu" : "Lưu"} />
                </button>
              </div>
            </div>

            <div className="go-form-section">
              <div className="go-form-title">
                <h3>Giới thiệu và liên hệ</h3>
                <span className="go-badge" data-tone="ok">Có hiệu lực ngay</span>
              </div>
              {isDraft ? (
                <>
                  <p className="go-muted-text">Hiện ở mục "Chi tiết" khi khách xem chi nhánh.</p>
                  <textarea
                    data-testid="gym-edit-description-input"
                    aria-label="Giới thiệu chi nhánh"
                    className="go-input go-textarea"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    maxLength={Math.max(ABOUT_MAX, editDescription.length)}
                    placeholder="Không gian, thiết bị, lớp tập, đội ngũ huấn luyện viên…"
                  />
                  <AboutCounter value={editDescription} />
                </>
              ) : (
                <div className="go-note" data-testid="gym-listing-managed-notice">
                  Giới thiệu của chi nhánh đã duyệt được sửa trong tab <strong>Tin đăng</strong> và gửi duyệt trước khi hiển thị với khách.
                  <GoLink to={`/gym-owner/gyms/${id}?tab=listing`} className="go-btn go-btn-sm">Sửa ở tab Tin đăng</GoLink>
                </div>
              )}
              <div className="go-grid-2">
                <input data-testid="gym-edit-phone-input" aria-label="Điện thoại chi nhánh" className="go-input" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} inputMode="tel" maxLength={20} placeholder="Điện thoại chi nhánh" />
                <input data-testid="gym-edit-email-input" aria-label="Email chi nhánh" className="go-input" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} inputMode="email" maxLength={200} placeholder="Email chi nhánh" />
              </div>
              <div className="go-form-actions">
                <button
                  type="button"
                  className="go-btn go-btn-sm"
                  data-variant="primary"
                  data-testid="gym-save-about-button"
                  onClick={() => update.mutate(isDraft ? { description: editDescription.trim(), phone: editPhone.trim(), email: editEmail.trim() } : { phone: editPhone.trim(), email: editEmail.trim() })}
                  disabled={update.isPending || (isDraft && editDescription.trim().length > ABOUT_MAX)}
                >
                  <TextStates value={update.isPending ? "Đang lưu" : isDraft ? "Lưu giới thiệu và liên hệ" : "Lưu liên hệ"} />
                </button>
              </div>
            </div>

            <div className="go-form-section">
              <div className="go-form-title">
                <h3>Thương hiệu</h3>
              </div>
              <p className="go-static">{brandName}</p>
            </div>

            <div className="go-form-section">
              <div className="go-form-title">
                <h3>Vị trí</h3>
                <span className="go-badge" data-tone="ok">Có hiệu lực ngay</span>
              </div>
              <p className="go-muted-text">Dùng để khách tìm được chi nhánh này theo tỉnh/thành và thấy đúng chi nhánh gần mình nhất.</p>
              <GymLocationFields value={editLocation} onChange={setEditLocation} />
              <label className="go-field">
                <span className="go-label">Hướng dẫn tới nơi (tuỳ chọn)</span>
                <input className="go-input" value={editLocationNote} onChange={(e) => setEditLocationNote(e.target.value)} placeholder="Ví dụ: Toà nhà màu xanh, cổng sau, tầng 3" maxLength={300} />
              </label>
              <div className="go-form-actions">
                <button type="button" className="go-btn go-btn-sm" data-variant="primary" data-testid="gym-save-location-button" onClick={() => update.mutate({ ...editLocation, locationNote: editLocationNote })} disabled={update.isPending}>
                  <TextStates value={update.isPending ? "Đang lưu" : "Lưu vị trí"} />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {wallet.canSee && <WalletBlock gymId={id} role={role} canWithdraw={wallet.canWithdraw} />}

      <section className="go-card" aria-labelledby="go-h-checkin">
        <div className="go-card-head">
          <h2 id="go-h-checkin">Check-in tại chi nhánh</h2>
        </div>
        {/* Existing panel, unchanged: QR (show / regenerate / enlarge), recent check-ins and PT check-ins (polling inside). */}
        <div className="go-embed">
          <GymCheckinPanel gymId={id} branch={gym as never} />
        </div>
      </section>

      <section className="go-card" aria-labelledby="go-h-links">
        <div className="go-card-head">
          <h2 id="go-h-links">Liên quan tới chi nhánh</h2>
        </div>
        <ul className="go-linklist">
          <li>
            <div>
              <strong>Gói hội viên</strong>
              <p>Gói được quản lý chung cho cả thương hiệu, áp dụng ở mọi chi nhánh.</p>
            </div>
            <GoLink to="/gym-owner/members?tab=plans" className="go-btn go-btn-sm">Quản lý gói</GoLink>
          </li>
          <li data-testid="go-branch-members-link">
            <div>
              <strong>Hội viên của chi nhánh</strong>
              <p>Danh sách hội viên, hiệu lực gói và lượt dùng của chi nhánh này.</p>
            </div>
            <GoLink to={`/gym-owner/members?gymId=${encodeURIComponent(id)}&tab=members`} className="go-btn go-btn-sm">Hội viên của chi nhánh</GoLink>
          </li>
          {canUseFeature(role, "collaborations") && (
            <li data-testid="gym-collab-brand-note">
              <div>
                <strong>Hợp tác huấn luyện viên</strong>
                <p>Hợp tác với PT được ký ở cấp thương hiệu và áp dụng một bộ điều khoản cho mọi chi nhánh, nên không quản lý riêng từng chi nhánh.</p>
              </div>
              <GoLink to="/gym-owner/collaborations" className="go-btn go-btn-sm">Mở Quản lý cộng tác</GoLink>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
