import {
  SquaresFourIcon,
  ScanIcon,
  HeadCircuitIcon,
  BarbellIcon,
  ForkKnifeIcon,
  CompassIcon,
  TicketIcon,
  ChatCircleDotsIcon,
  WalletIcon,
  UserCircleIcon,
  GearSixIcon,
} from "@phosphor-icons/react";
import { createGyminiIcon } from "./base";

/**
 * P0 — core Gymini navigation icons (desktop Sidebar + mobile BottomNav, every role). Each is
 * a real Phosphor icon (see docs/features/GYMINI_PHOSPHOR_ICON_MIGRATION_REPORT.md for the
 * full mapping table + why each one was picked over its neighbors) — nothing here is a
 * redrawn/custom path.
 */

// Dashboard — overview grid. Distinct from Activity/Pulse (unrelated) and from InBody.
export const GyminiDashboardIcon = createGyminiIcon("GyminiDashboardIcon", SquaresFourIcon);

// InBody — body scan (composition), not the same glyph as Profile or Dashboard.
export const GyminiInBodyIcon = createGyminiIcon("GyminiInBodyIcon", ScanIcon);

// Plan (AI) — a head rendered as a circuit board: reads as "AI thinking" distinctly from a
// plain Brain (used elsewhere in the app for a different purpose, e.g. LoginPage's feature list).
export const GyminiPlanIcon = createGyminiIcon("GyminiPlanIcon", HeadCircuitIcon);

// Workout — barbell.
export const GyminiWorkoutIcon = createGyminiIcon("GyminiWorkoutIcon", BarbellIcon);

// Nutrition — fork + knife.
export const GyminiNutritionIcon = createGyminiIcon("GyminiNutritionIcon", ForkKnifeIcon);

// Discover — compass.
export const GyminiDiscoverIcon = createGyminiIcon("GyminiDiscoverIcon", CompassIcon);

// Services — a ticket/voucher (browsing PT & gym service offerings to buy), distinct from the
// Marketplace storefront glyph below.
export const GyminiServicesIcon = createGyminiIcon("GyminiServicesIcon", TicketIcon);

// Chat.
export const GyminiChatIcon = createGyminiIcon("GyminiChatIcon", ChatCircleDotsIcon);

// Wallet — distinct from Money (CurrencyDollar in feature.tsx).
export const GyminiWalletIcon = createGyminiIcon("GyminiWalletIcon", WalletIcon);

// Profile — distinct from Users (a group) and from InBody (a scan).
export const GyminiProfileIcon = createGyminiIcon("GyminiProfileIcon", UserCircleIcon);

// Settings — gear.
export const GyminiSettingsIcon = createGyminiIcon("GyminiSettingsIcon", GearSixIcon);
