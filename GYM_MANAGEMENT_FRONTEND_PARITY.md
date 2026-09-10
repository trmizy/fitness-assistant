# GYM_MANAGEMENT_FRONTEND_PARITY.md

GYM_MANAGEMENT master spec §65/§64 deliverable — "compare the new frontend against the
existing one... every existing Gym Owner / Admin Gym function must remain accessible."
Written after all 5 phases; nothing below was removed, only extended or retrofitted onto the
shared design-system library (`components/ui/`, `components/gym-management/`).

| Existing route | New/changed screen | API preserved? | Actions preserved? | Mobile | Desktop | Known gap |
|---|---|---|---|---|---|---|
| `/admin/gyms` (AdminGymModeration) | Same route — status pills retrofitted onto `ModerationStatusBadge`; added "Yêu cầu chỉnh sửa" button + panel | ✅ all existing endpoints untouched | ✅ Owners/Duyệt/Đổi tên/Đóng cửa vĩnh viễn/Tất cả chi nhánh all still there | ⚠️ not re-verified at 390/430px this round (only 1440px checked live) | ✅ verified live | — |
| `/admin/partners` (AdminPartnersPage) | Same route — 6 tabs → 8 tabs (added Ghi chú nội bộ, Khiếu nại); status pills retrofitted; verification-axis panel added to Overview | ✅ | ✅ Cấp tài khoản/Tạm khoá/Chấm dứt/Xem-dưới-góc-nhìn-đối-tác all still there | ⚠️ not re-verified at mobile widths | ✅ verified live | 3 tabs still missing vs the spec's 11: separate BRAND, MEMBERSHIPS, PT COLLABORATIONS |
| *(none — new)* | `/admin/gym-management` (AdminGymManagementOverview) | n/a, new | n/a | ⚠️ not re-verified at mobile widths | ✅ verified live | — |
| *(none — new)* | `/admin/complaints` (AdminComplaintsPage) | n/a, new | n/a | ⚠️ not re-verified at mobile widths | ✅ verified live | — |
| `/gym-owner/dashboard` (GymOwnerDashboard) | Same route — added "Cần chú ý" action center above the KPI row | ✅ | ✅ all existing charts/KPIs/links unchanged | ⚠️ not re-verified at mobile widths | ✅ verified live | — |
| `/gym-owner/gyms` (MyGymsPage) | Same route — brand-rename/add-branch controls now hidden for a MANAGER account | ✅ | ✅ OWNER sees everything exactly as before; MANAGER's reduced view is the intended change | ✅ verified live (both OWNER and MANAGER) | ✅ verified live | Standalone (pre-brand-model) gyms section not given the same OWNER/MANAGER gate — low practical risk, no MANAGER should ever reach that code path |
| `/gym-owner/gyms/:id` (GymManagePage) | Same route — added expected-reopen-date input on temporary closure, and a view of any standing "Request Changes" note | ✅ | ✅ | ⚠️ not re-verified at mobile widths | ✅ verified live | Wallet section still has no MANAGER-specific client-side hide (server-side `requirePartnerOwner` already blocks it) |
| `/client/services` → "Hội viên gym" tab (GymMembershipsPage) | Same route — added "Báo cáo vấn đề" button (ACTIVE and recently-EXPIRED cards) | ✅ | ✅ Quét mã check-in/Hủy membership/Pay Now unchanged | ✅ dialog verified live at 1440px; not separately checked at phone width | ✅ verified live | — |
| Sidebar (all roles) | Admin: added Tổng quan Gym, renamed Quản lý gym→Chi nhánh and Đối tác phòng tập→Đối tác, added Khiếu nại. Gym owner: MANAGER-aware filtering (Người quản lý/Quản lý cộng tác hidden) | ✅ every pre-existing admin/owner nav destination still resolves | ✅ | ✅ verified live | ✅ verified live | No standalone Membership Oversight / Notifications nav items yet (no backing screen for either) |

## Deliberately unchanged (out of scope for this project, confirmed earlier in the session)

AI coaching, Workout, Nutrition, Marketplace — never touched. PT contract policy, session
lifecycle, no-show rules, compensation formulas, the 3-way money split — never touched.
`GYM_STAFF` was not reintroduced anywhere.

## Still outstanding after Phase 5

- A formal responsive-breakpoint verification pass at all six named widths (360/390/430/768/1024/1440) across every touched screen — most of this session's live verification was at 1440px (desktop) with a handful of 390px checks in Phase 2's component showcase; the actual production screens above were mostly verified at 1440px only.
- The 3 remaining partner-detail tabs (BRAND, MEMBERSHIPS, PT COLLABORATIONS) noted in `GYM_MANAGEMENT_API_GAPS.md` §3.
- Membership plan `SINGLE_BRANCH`/`ALL_BRAND_BRANCHES` access scope — explicitly deferred (user decision, Phase 3).
- Broader owner-facing notification wiring beyond complaints-resolved (branch-review "Request Changes", invitation-received, partner-suspended).
- Mobile-specific interaction patterns (bottom nav, bottom sheets for filter/sort on the admin/owner workspaces) — the shared `FilterSheet`/`InviteAccountSheet` components already default to a bottom sheet on mobile per §48, but no admin/owner screen actually uses them yet outside the Phase 2 showcase.
