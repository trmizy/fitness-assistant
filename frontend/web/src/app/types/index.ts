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
  fitnessLevel?: 'beginner' | 'intermediate' | 'advanced';
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
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
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
  role: 'user' | 'assistant';
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
  type: 'DIRECT';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipant[];
  messages: ChatMessage[];
}

// ── Contract types ───────────────────────────────────────────────
export type ContractStatus = 'PENDING_REVIEW' | 'PENDING_SIGNATURE' | 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED' | 'REJECTED';
export type PackageType = 'PER_SESSION' | 'PACKAGE';

export interface Contract {
  id: string;
  ptUserId: string;
  clientUserId: string;
  status: ContractStatus;
  packageType: PackageType;
  sessionMode?: 'ONLINE' | 'OFFLINE' | 'HYBRID';
  packageName: string;
  description?: string;
  totalSessions: number;
  usedSessions: number;
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
}

// ── Session types ────────────────────────────────────────────────
export type SessionStatus = 'REQUESTED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type SessionMode = 'ONLINE' | 'OFFLINE' | 'HYBRID';

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
  createdAt: string;
  updatedAt: string;
  review?: SessionReview;
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

// ── Notification types ───────────────────────────────────────────
export type NotificationEventType =
  | 'CONTRACT_REQUESTED' | 'CONTRACT_ACCEPTED' | 'CONTRACT_REJECTED' | 'CONTRACT_CANCELLED'
  | 'SESSION_BOOKED' | 'SESSION_CONFIRMED' | 'SESSION_COMPLETED' | 'SESSION_CANCELLED'
  | 'SESSION_NO_SHOW_CLIENT' | 'SESSION_NO_SHOW_PT';

export type NotificationEntityType = 'CONTRACT' | 'SESSION';

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
export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

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
export type CallType = 'VOICE' | 'VIDEO';
export type CallStatus = 'INITIATING' | 'RINGING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'CONNECTING' | 'ACTIVE' | 'ENDED' | 'MISSED' | 'FAILED';
export type CallOrigin = 'CHAT' | 'SESSION';

export type CallUIState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

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
  ownerType: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';
  ownerId: string;
  availableBalance: string;
  lockedBalance: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
}

export interface WalletLedgerEntry {
  id: string;
  walletId: string;
  transactionId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  description?: string;
  createdAt: string;
}

// ── Gym marketplace types (Phase 4) ─────────────────────────────────
export type GymStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type GymMembershipPlanStatus = 'ACTIVE' | 'INACTIVE';
export type GymMembershipContractStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface Gym {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  address: string;
  city?: string;
  phone?: string;
  email?: string;
  status: GymStatus;
  createdAt: string;
  updatedAt: string;
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
