import {
  UsersIcon,
  FileTextIcon,
  CalendarCheckIcon,
  BuildingsIcon,
  ShieldCheckIcon,
  StorefrontIcon,
  ArrowsLeftRightIcon,
  GridNineIcon,
  CurrencyDollarIcon,
  GaugeIcon,
  GavelIcon,
  FlowArrowIcon,
} from "@phosphor-icons/react";
import { createGyminiIcon } from "./base";

/**
 * P1 — secondary Gymini navigation icons (role-specific sidebar sections: PT workspace,
 * gym-owner, admin). Same Phosphor-foundation approach as core.tsx.
 */

// Users — group of people (Học viên / Người dùng), distinct from the single-person Profile.
export const GyminiUsersIcon = createGyminiIcon("GyminiUsersIcon", UsersIcon);

// Contract — document (signed agreement), distinct from a generic FileText usage elsewhere.
export const GyminiContractIcon = createGyminiIcon("GyminiContractIcon", FileTextIcon);

// Schedule — calendar with a check (a booked/confirmed slot), distinct from a bare date-only
// Calendar used elsewhere.
export const GyminiScheduleIcon = createGyminiIcon("GyminiScheduleIcon", CalendarCheckIcon);

// Gym — a building (the physical venue), distinct from Workout's Barbell and from Marketplace.
export const GyminiGymIcon = createGyminiIcon("GyminiGymIcon", BuildingsIcon);

// Admin — shield with a check (verified authority).
export const GyminiAdminIcon = createGyminiIcon("GyminiAdminIcon", ShieldCheckIcon);

// Marketplace — storefront, distinct from the Gym building and the Services ticket.
export const GyminiMarketplaceIcon = createGyminiIcon("GyminiMarketplaceIcon", StorefrontIcon);

// Compare — two-way arrows (duplicate-exercise review).
export const GyminiCompareIcon = createGyminiIcon("GyminiCompareIcon", ArrowsLeftRightIcon);

// Catalog — a 3×3 matrix, distinct from Dashboard's overview grid (SquaresFour, 2×2 feel).
export const GyminiCatalogIcon = createGyminiIcon("GyminiCatalogIcon", GridNineIcon);

// Money — currency symbol, distinct construction/semantic from Wallet.
export const GyminiMoneyIcon = createGyminiIcon("GyminiMoneyIcon", CurrencyDollarIcon);

// System — a gauge/meter (observability/monitoring), distinct from a plain Monitor screen.
export const GyminiSystemIcon = createGyminiIcon("GyminiSystemIcon", GaugeIcon);

// Dispute — gavel (adjudication).
export const GyminiDisputeIcon = createGyminiIcon("GyminiDisputeIcon", GavelIcon);

// Workflow — branching flow arrow, distinct from Compare (no branch/merge there) and from
// Plan's HeadCircuit.
export const GyminiWorkflowIcon = createGyminiIcon("GyminiWorkflowIcon", FlowArrowIcon);
