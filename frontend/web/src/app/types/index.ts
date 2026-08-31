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
  // Money-flow plan 4.1: the client-confirmation window (PENDING_CLIENT_CONFIRMATION →
  // COMPLETED, or DISPUTED if the client objects before this deadline).
  clientConfirmDeadline?: string | null;
  autoConfirmed?: boolean;
  disputeReason?: string | null;
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

/** A chain: one owner, one name, many physical locations (branches, below). */
export interface GymBrand {
  id: string;
  ownerId: string;
  name: string;
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
  description?: string;
  address: string;
  city?: string;
  phone?: string;
  email?: string;
  status: GymStatus;
  createdAt: string;
  updatedAt: string;
  averageRating?: number; // public DTO only
  reviewCount?: number; // public DTO only
  /** Included on public/owner listings so the client can group branches without a second call. */
  brand?: { id: string; name: string } | null;
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
