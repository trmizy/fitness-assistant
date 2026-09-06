/**
 * Compatibility layer for the 23 branded Gymini navigation icons.
 *
 * History: this file used to BE a procedural icon generator (`ICON_SEEDS` → `motif(seed % 16)`
 * → `makeIcon()`), then briefly a hand-drawn-SVG generator, then a Phosphor-backed re-export of
 * ~180 generic icon names PLUS these 23 branded ones. That middle state relied on a
 * `vite.config.ts` alias redirecting the bare `"lucide-react"` specifier to this file so all
 * 123 consumer files didn't need editing — but it meant every one of those ~180 icons got
 * bundled into one shared chunk instead of being code-split per page (measured: the main
 * bundle chunk grew ~450KB). That's fixed now the direct way: all 123 files were migrated to
 * import their icons straight from `@phosphor-icons/react` (see
 * docs/features/GYMINI_PHOSPHOR_ICON_MIGRATION_REPORT.md), the `lucide-react` alias and
 * dependency are both removed, and this file only exports what's still genuinely imported from
 * it: the 23 `GyminiXIcon` names `Sidebar.tsx`/`BottomNav.tsx` use for the app's actual branded
 * navigation icons (defined in `../icons/gymini/{core,feature}.tsx`, each a real Phosphor icon
 * wrapped for tone/weight/state — see `../icons/gymini/base.tsx`).
 */
export {
  GyminiDashboardIcon,
  GyminiInBodyIcon,
  GyminiPlanIcon,
  GyminiWorkoutIcon,
  GyminiNutritionIcon,
  GyminiDiscoverIcon,
  GyminiServicesIcon,
  GyminiChatIcon,
  GyminiWalletIcon,
  GyminiProfileIcon,
  GyminiSettingsIcon,
  GyminiUsersIcon,
  GyminiContractIcon,
  GyminiScheduleIcon,
  GyminiGymIcon,
  GyminiAdminIcon,
  GyminiMarketplaceIcon,
  GyminiCompareIcon,
  GyminiCatalogIcon,
  GyminiMoneyIcon,
  GyminiSystemIcon,
  GyminiDisputeIcon,
  GyminiWorkflowIcon,
} from "../icons/gymini";
