export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
  bio?: string;
  height?: number;
  weight?: number;
  age?: number;
  goal?: string;
  fitnessLevel?: "beginner" | "intermediate" | "advanced";
  isPT?: boolean;
  /** True only for an admin-created account (currently just gym owners) still on its random
   * temporary password. AppShell blocks all navigation behind a forced change-password
   * screen while this is true; cleared server-side the moment any password change succeeds. */
  mustChangePassword?: boolean;
}

export interface InBodyEntry {
  id: string;
  date: string;
  weight: number;
  bodyFat: number;
  muscleMass: number;
  bmi: number;
  bmr: number;
  visceralFat?: number;
  notes?: string;
}

export interface SetLog {
  reps: number;
  weight: number;
  rpe?: number;
}

export interface ExerciseLog {
  id: string;
  exerciseName: string;
  sets: SetLog[];
}

export interface WorkoutLog {
  id: string;
  name: string;
  date: string;
  duration: number;
  notes?: string;
  exercises: ExerciseLog[];
}

export interface WorkoutPlanExercise {
  name: string;
  sets: number;
  reps: string;
  rest: string;
  notes?: string;
}

export interface WorkoutPlanDay {
  day: string;
  label: string;
  focus: string;
  isRest: boolean;
  exercises: WorkoutPlanExercise[];
}

export interface MealItem {
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface MealPlanDay {
  day: string;
  label: string;
  totalCalories: number;
  totalProtein: number;
  meals: MealItem[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// ── Chat types ────────────────────────────────────────────────
export interface ConversationParticipant {
  id: string;
  conversationId: string;
  userId: string;
  joinedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  type: "DIRECT";
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipant[];
  messages: ChatMessage[];
}

// ── Contract types ───────────────────────────────────────────────
export type ContractStatus =
  | "PENDING_REVIEW"
  | "PENDING_SIGNATURE"
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED"
  | "REJECTED";
export type PackageType = "PER_SESSION" | "PACKAGE";

/** The other party on a contract, as attached by user-service (`ptProfile`/`clientProfile`). */
export interface ContractPartyProfile {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  photoUrl?: string | null;
}

export interface Contract {
  id: string;
  ptUserId: string;
  clientUserId: string;
  status: ContractStatus;
  packageType: PackageType;
  sessionMode?: "ONLINE" | "OFFLINE" | "HYBRID";
  packageName: string;
  description?: string;
  totalSessions: number;
  usedSessions: number;
  /** PT no-shows already compensated in cash — counts against remaining entitlement the same
   * as usedSessions, but is not folded into it (money-flow plan 1.5). Optional because older
   * cached API responses predate the field; treat a missing value as 0. */
  compensatedSessions?: number;
  price?: number;
  pricePerSession?: number;
  startDate?: string;
  endDate?: string;
  completedAt?: string;
  clientMessage?: string;
  rejectionReason?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  terms?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  sessions?: Session[];
  /** Attached on `/contracts/client` — who the trainer is. */
  ptProfile?: ContractPartyProfile | null;
  /** Attached on `/contracts/pt` — who the client is. */
  clientProfile?: ContractPartyProfile | null;
  /** Attached on `/contracts/pt` — this client's aggregate rating from OTHER PTs' past
   * sessions with them (ClientReview, the mirror-image of a PT's own SessionReview rating). */
  clientRating?: { avgRating: number | null; ratingCount: number };
}

// ── Session types ────────────────────────────────────────────────
// Money-flow plan 3.3: "RESCHEDULE_PENDING" removed — it is not a real backend status (a
// session deliberately stays CONFIRMED while a reschedule proposal is pending; see
// booking.service.ts's own comment on respondToReschedule). Whether a reschedule is pending is
// read from the session's `rescheduleRequests` array, never from `status`.
export type SessionStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "PENDING_CLIENT_CONFIRMATION"
  | "DISPUTED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULE_PENDING";
export type SessionMode = "ONLINE" | "OFFLINE" | "HYBRID";

export interface SessionRescheduleRequest {
  id: string;
  sessionId: string;
  requestedBy: "CLIENT" | "PT";
  originalStartAt: string;
  originalEndAt: string;
  proposedStartAt: string;
  proposedEndAt: string;
  reason: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  respondedAt: string | null;
  responseNote: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  contractId: string;
  clientUserId: string;
  ptUserId: string;
  status: SessionStatus;
  sessionMode: SessionMode;
  scheduledStartAt: string;
  scheduledEndAt: string;
  location?: string;
  notes?: string;
  ptNotes?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  sessionDeducted: boolean;
  completedAt?: string;
  /** Vòng 4 / Phase E2 — true only when this NO_SHOW was actually the PT's fault. 3+ across a
   * contract's sessions gives the client the right to terminate for a full refund. */
  ptAtFault?: boolean;
  // Money-flow plan 4.1: the client-confirmation window (PENDING_CLIENT_CONFIRMATION →
  // COMPLETED, or DISPUTED if the client objects before this deadline).
  clientConfirmDeadline?: string | null;
  autoConfirmed?: boolean;
  disputeReason?: string | null;
  /** Vòng 4 / Phase E4 — audit/admin-screen classification only, set once when the session
   * first enters DISPUTED. Never changes how resolveDispute rules on it. */
  disputeType?: "DELIVERY_DISPUTE" | "PT_NO_SHOW_CLAIM" | "CLIENT_NO_SHOW_CLAIM" | null;
  createdAt: string;
  updatedAt: string;
  review?: SessionReview;
  /** Mirror-image of `review` — the PT's rating of the client for this session, if given. */
  clientReview?: ClientReview;
  rescheduleRequests?: SessionRescheduleRequest[];
}

export interface SessionReview {
  id: string;
  sessionId: string;
  contractId: string;
  clientUserId: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

/** Mirror-image of SessionReview — the PT rates the client instead of the client rating the PT. */
export interface ClientReview {
  id: string;
  sessionId: string;
  contractId: string;
  ptUserId: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

// ── Notification types ───────────────────────────────────────────
export type NotificationEventType =
  | "CONTRACT_REQUESTED"
  | "CONTRACT_ACCEPTED"
  | "CONTRACT_REJECTED"
  | "CONTRACT_CANCELLED"
  | "SESSION_BOOKED"
  | "SESSION_CONFIRMED"
  | "SESSION_COMPLETED"
  | "SESSION_CANCELLED"
  | "SESSION_NO_SHOW_CLIENT"
  | "SESSION_NO_SHOW_PT"
  // Roadmap P4.1 "Notifications/reminders" (§27).
  | "WORKOUT_UPCOMING"
  | "WORKOUT_RESCHEDULED"
  | "WORKOUT_UNFINISHED"
  | "TRAINING_PLAN_UPDATED"
  | "PT_FEEDBACK_RECEIVED";

export type NotificationEntityType = "CONTRACT" | "SESSION" | "WORKOUT_SCHEDULE" | "TRAINING_PROGRAM";

export interface AppNotification {
  id: string;
  userId: string;
  text: string;
  eventType: NotificationEventType;
  entityType: NotificationEntityType;
  entityId: string;
  link?: string;
  unread: boolean;
  createdAt: string;
}

// ── Availability types ───────────────────────────────────────────
export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface PTAvailabilitySlot {
  id: string;
  ptUserId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface PTScheduleException {
  id: string;
  ptUserId: string;
  date: string;
  reason?: string;
}

// ── Call types ──────────────────────────────────────────────────
export type CallType = "VOICE" | "VIDEO";
export type CallStatus =
  | "INITIATING"
  | "RINGING"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED"
  | "CONNECTING"
  | "ACTIVE"
  | "ENDED"
  | "MISSED"
  | "FAILED";
export type CallOrigin = "CHAT" | "SESSION";

export type CallUIState =
  | "idle"
  | "outgoing"
  | "incoming"
  // Open-room sessions only, below — never reached by a CHAT-origin call.
  | "preview" // choosing mic/cam before entering the room
  | "waiting" // already joined, alone — waiting for the other party to arrive
  | "connecting"
  | "active";

export interface CallSessionInfo {
  callSessionId: string;
  callerId: string;
  calleeId: string;
  callerName?: string;
  callType: CallType;
  origin: CallOrigin;
  conversationId: string;
  iceServers?: RTCIceServer[];
  /** Open-room sessions only — the coaching session this room belongs to. */
  coachingSessionId?: string;
  /** Open-room sessions only — when the room closes for good (booking.service.ts's
   * joinSession), drives the countdown/closing-warning UI. */
  roomClosesAt?: string;
}

export interface CallState {
  uiState: CallUIState;
  callInfo: CallSessionInfo | null;
  isMuted: boolean;
  isVideoOff: boolean;
  remoteMuted: boolean;
  remoteVideoOff: boolean;
  callDuration: number;
}

// ── Wallet types (Phase 4) ──────────────────────────────────────────
export interface Wallet {
  id: string;
  ownerType: "CLIENT" | "PT" | "GYM" | "PLATFORM";
  ownerId: string;
  availableBalance: string;
  // Revenue already credited but held until the underlying contract/membership ends (see
  // docs/money-flow.md §13.3) — not withdrawable yet. The API has always returned this;
  // it was just missing from this type, which is why no wallet screen ever drew it.
  pendingBalance: string;
  lockedBalance: string;
  status: "ACTIVE" | "FROZEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
}

export interface WalletLedgerEntry {
  id: string;
  walletId: string;
  transactionId: string;
  entryType: "DEBIT" | "CREDIT";
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  description?: string;
  createdAt: string;
}

// ── Gym marketplace types (Phase 4) ─────────────────────────────────
export type GymStatus =
  // GYM_BRANCH_FORM_SPEC.md, Phase 1 — the "Add Branch" wizard's pre-validation state. Never
  // shown in any admin queue or public listing — see schema.prisma's own doc comment.
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";
export type GymMembershipPlanStatus = "ACTIVE" | "INACTIVE";
export type GymMembershipContractStatus =
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELLED";

export type GymOperationalStatus = "OPEN" | "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED";

// GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §20: single interval per day
// only (no split hours) — matches the backend, which never had multi-interval support.
export type WeekDay = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
export type DayScheduleType = "OPEN" | "CLOSED" | "ALL_DAY";
export interface GymOperatingHoursDay {
  id: string | null;
  gymId: string;
  day: WeekDay;
  type: DayScheduleType;
  openMinute: number | null;
  closeMinute: number | null;
}

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 4 "Facilities & Services". Must match the
// `GymFacility` Prisma enum exactly.
export type GymFacility =
  | "FREE_WEIGHTS" | "CARDIO_MACHINES" | "FUNCTIONAL_TRAINING_AREA" | "GROUP_CLASSES"
  | "YOGA_STUDIO" | "SWIMMING_POOL" | "PERSONAL_TRAINER" | "INBODY_SCAN" | "LOCKER_ROOM"
  | "SHOWER" | "SAUNA" | "TOWEL_SERVICE" | "PARKING" | "WIFI" | "AIR_CONDITIONING"
  | "DRINKING_WATER" | "KIDS_AREA" | "VENDING_MACHINE";

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Public gallery — `fileName` joins with
// `/uploads/gym-photos/` to form the full public URL, same token-not-URL convention as
// GymComplaint.photoTokens.
export interface GymPhoto {
  id: string;
  gymId: string;
  fileName: string;
  sortOrder: number;
  isCover: boolean;
  createdAt: string;
}

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification" (branch-level only, §95.4 — NOT
// the partner-level business registration/tax/rep-identity, collected once at partner
// vetting). Reuses PartnerDocumentStatus's exact value set (see gym-service's schema.prisma
// doc comment for why no duplicate enum was created).
export type BranchDocumentType = "LEASE_OR_PROPERTY_DOC" | "FIRE_SAFETY_CERTIFICATE" | "FACILITY_PHOTOS";
export type PartnerDocumentStatus = "PENDING" | "RECEIVED" | "VERIFIED" | "REJECTED";
export interface GymBranchDocument {
  id: string | null;
  gymId: string;
  docType: BranchDocumentType;
  required: boolean;
  /** Token riêng tư từ branch-documents upload, không phải URL công khai — dùng với
   * AuthenticatedImage, cùng quy ước với GymComplaint.photoTokens. */
  fileToken: string | null;
  status: PartnerDocumentStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
}
/** Ngữ cảnh chỉ đọc — giấy tờ cấp ĐỐI TÁC (đã thu thập một lần lúc thẩm định), không phải
 * giấy tờ cấp chi nhánh ở trên. §95.4. */
export interface PartnerDocumentContext {
  id: string | null;
  partnerId: string;
  docType: string;
  required: boolean;
  fileUrl: string | null;
  status: PartnerDocumentStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
}

// GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category on a branch's first-time
// wizard submission. Distinct from Gym.pendingNameNote/pendingAddressNote (name/address only,
// post-approval renames) — see gym-service's GymBranchReviewIssue schema doc comment.
export type BranchReviewCategory = "BASIC_INFO" | "LOCATION" | "OPENING_HOURS" | "FACILITIES" | "PHOTOS" | "VERIFICATION" | "OTHER";
export interface GymBranchReviewIssue {
  id: string;
  gymId: string;
  category: BranchReviewCategory;
  message: string;
  createdBy: string;
  resolvedAt: string | null;
  createdAt: string;
}

// ── GYM_MANAGEMENT master spec, Phase 5 — Khiếu nại/Vi phạm ─────────────────────────────
export type ComplaintSource = "SELF_DETECTED" | "MEMBER_REPORT" | "PT_REPORT" | "PARTNER_DISCLOSED";
export type ComplaintIssueType =
  | "CLEANLINESS"
  | "STAFF_BEHAVIOR"
  | "EQUIPMENT_CONDITION"
  | "FALSE_ADVERTISING"
  | "BILLING"
  | "SAFETY"
  | "OTHER";
export type ComplaintStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

/** Riêng tư — chỉ admin và chính người báo cáo xem được (khác GymReview: công khai, có sao). */
export interface GymComplaint {
  id: string;
  gymId: string;
  partnerId: string | null;
  source: ComplaintSource;
  issueType: ComplaintIssueType;
  reporterUserId: string | null;
  description: string;
  /** Token riêng tư từ complaint-photos, không phải URL công khai — dùng với AuthenticatedImage. */
  photoTokens: string[];
  status: ComplaintStatus;
  assignedAdminId: string | null;
  adminResponse: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A chain: one owner, one name, many physical locations (branches, below). */
export interface GymBrand {
  id: string;
  ownerId: string;
  name: string;
  /** Vòng 4 / Phase C1 — moderation overlay. Public pages read `approvedName`; `name` is the
   * owner's current working value (mirrors `pendingName` whenever a rename hasn't been
   * approved yet). Owner-facing screens: show `approvedName ?? name` as "current", and a
   * "Tên mới đang chờ duyệt: …" hint whenever `pendingName` is set. */
  approvedName?: string | null;
  pendingName?: string | null;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Present only on GET /owner/brands/:id — the branch-management view. */
  branches?: Gym[];
}

export interface Gym {
  id: string;
  ownerId: string;
  /** Which brand this location belongs to, if any — most gyms have none. */
  brandId?: string | null;
  name: string;
  /** Vòng 4 / Phase C2 — same overlay as GymBrand.approvedName/pendingName above, for both
   * name and address. */
  approvedName?: string | null;
  pendingName?: string | null;
  description?: string;
  address: string;
  approvedAddress?: string | null;
  pendingAddress?: string | null;
  city?: string;
  /** Lọc "theo tỉnh/thành phố" ở trang tìm phòng gym — denormalized từ VietnamProvince/
   * VietnamWard bên user-service, không FK xuyên service (cùng quy ước `ownerId`). */
  provinceCode?: number | null;
  wardCode?: number | null;
  /** Toạ độ chi nhánh — chủ gym tự lấy bằng "Dùng vị trí hiện tại" lúc tạo/sửa. Dùng để
   * sắp xếp chi nhánh gần khách nhất lên đầu ở trang tìm kiếm. */
  latitude?: number | null;
  longitude?: number | null;
  /** GYM_BRANCH_FORM_SPEC.md §14/§74 — free-text directions on top of the formal address
   * (e.g. "cổng sau, tầng 3"). Free edit even after approval, no material-change gating. */
  locationNote?: string | null;
  /** GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 4. Free edit, no material-change gating. */
  facilities?: GymFacility[];
  phone?: string;
  email?: string;
  status: GymStatus;
  /** GYM_BRANCH_FORM_SPEC.md Phase 1 — the wizard's resume position, only meaningful while
   * `status === "DRAFT"`. */
  wizardStep?: number | null;
  /** GYM_MANAGEMENT master spec §60/§62 (Phase 1) — per-field "Request Changes" notes, set
   * by an admin instead of a blunt approve/reject. Cleared automatically when the owner edits
   * the corresponding field again or when the admin approves. */
  pendingNameNote?: string | null;
  pendingAddressNote?: string | null;
  changesRequestedAt?: string | null;
  changesRequestedBy?: string | null;
  /** Vòng 4 / Phase C3 — the owner's own open/closed switch, independent from `status`. */
  operationalStatus?: GymOperationalStatus;
  closureReason?: string | null;
  /** GYM_MANAGEMENT master spec §61 (Phase 1) — owner-entered expected reopen date, only
   * meaningful while operationalStatus is TEMPORARILY_CLOSED. */
  expectedReopenAt?: string | null;
  closedAt?: string | null;
  reopenedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  averageRating?: number; // public DTO only
  reviewCount?: number; // public DTO only
  /** Giá gói rẻ nhất đang mở bán của thương hiệu (public DTO only) — null nếu chưa có gói
   * nào, không phải 0. Dùng để lọc "theo mức giá" ở trang tìm kiếm. */
  fromPrice?: string | null;
  activeMemberCount?: number; // owner listing only (GET /owner/gyms)
  /** Included on public/owner listings so the client can group branches without a second call. */
  brand?: { id: string; name: string; approvedName?: string | null; pendingName?: string | null } | null;
}

export interface GymMembershipPlan {
  id: string;
  gymId: string;
  name: string;
  description?: string;
  price: string;
  durationDays: number;
  visitLimit?: number;
  status: GymMembershipPlanStatus;
  /** Marketing window: the plan can only be bought while now is inside this range. Both
   * unset means always on sale while status is ACTIVE. */
  saleStartAt?: string | null;
  saleEndAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GymMembershipContract {
  id: string;
  gymId: string;
  planId: string;
  clientId: string;
  status: GymMembershipContractStatus;
  paymentTxnId?: string;
  startDate?: string;
  endDate?: string;
  priceAtPurchase: string;
  durationDaysSnapshot: number;
  totalVisits?: number;
  usedVisits: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 4: check-in + reviews ─────────────────────────────────────
export interface CheckinToken {
  token: string;
  expiresAt: number; // epoch ms
  gymId: string;
}

export interface CheckinResult {
  ok: boolean;
  checkinId: string;
  clientId: string;
  usedVisits: number;
  totalVisits: number | null;
  checkedInAt: string;
}

export interface GymCheckIn {
  id: string;
  membershipId: string;
  gymId: string;
  clientId: string;
  checkedInBy: string;
  createdAt: string;
}

export interface GymReview {
  id: string;
  gymId: string;
  clientId: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GymReviewsResponse {
  averageRating: number;
  count: number;
  reviews: GymReview[];
}
