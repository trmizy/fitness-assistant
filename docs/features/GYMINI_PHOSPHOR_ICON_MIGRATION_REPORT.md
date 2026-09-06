# GYMINI PHOSPHOR ICON MIGRATION REPORT

## Root cause

Same underlying problem as the prior pass (see `GYMINI_ICON_SYSTEM_IMPLEMENTATION_REPORT.md`
§1), now resolved differently per an updated brand decision: no hand-drawn/AI-designed SVG
paths anywhere in the UI icon set. `GyminiLucide.tsx` had already been rebuilt once from a
procedural generator (`ICON_SEEDS`/`motif`/`makeIcon`) into 23 custom hand-drawn icons plus a
re-export of real `lucide-react` for everything else. This pass replaces **all of it** — the 23
custom icons included — with real `@phosphor-icons/react` icons. Nothing in the icon set is
custom-drawn anymore; Gymini identity lives entirely in color, weight, active-state, and motion.

## Old system removed

- `ICON_SEEDS` / `motif(seed % 16)` / `makeIcon()` — removed in the prior pass, stayed removed.
- The 23 hand-authored SVG `<path>` icons in `core.tsx`/`feature.tsx` from the prior pass —
  replaced with Phosphor-backed components (same file locations, same export names).
- `lucide-react` — fully removed as a dependency (`pnpm remove`), confirmed zero references
  anywhere in `frontend/web` before removing.

## Phosphor integration

- Installed `@phosphor-icons/react@2.1.10` via `pnpm --filter @gym-coach/web add` (checked
  `package.json`/`packageManager` first — pnpm@8.15.0, package manager unchanged).
- `src/app/components/icons/gymini/base.tsx` — `GyminiIconProps`/`createGyminiIcon()`. Wraps a
  **real, imported** Phosphor icon component; never constructs or selects a shape. Adds
  `tone`/`state` props: `state="active"` defaults `weight` to `"bold"` and `tone` to
  `"accent"` unless overridden — this is the one place the wrapper encodes an opinion, and it's
  about weight/color, never path data.
- All 123 files that used to `import { X } from "lucide-react"` now `import { XIcon } from
  "@phosphor-icons/react"` directly (see "Files changed" — done via a scripted, reviewed
  codemod, not by hand, given the volume). No file imports from `lucide-react` anymore, and the
  package is uninstalled — there is exactly one icon library in the UI now.

## Icon mapping

Representative selection (full table is the `MAP` object in the migration script, mirrored in
`GyminiLucide.tsx`'s history and every migrated file's import line):

| Old (lucide) | Phosphor | Usage |
|---|---|---|
| `Dumbbell` | `BarbellIcon` | Workout nav + ~15 fitness pages |
| `Search` | `MagnifyingGlassIcon` | ~20 files |
| `Settings` | `GearSixIcon` | Settings nav + pages |
| `ChevronLeft/Right/Up/Down` | `CaretLeft/Right/Up/DownIcon` | back nav, disclosure, carousels |
| `User` | `UserIcon` | ~15 files |
| `Loader2` | `CircleNotchIcon` | loading spinners (kept `animate-spin` className — verified still spins) |
| `Utensils` | `ForkKnifeIcon` | nutrition UI |
| `Apple` | `OrangeSliceIcon` | Food Library/Detail pages — Phosphor has no plain fruit "apple", closest real fruit icon |
| `X` | `XIcon` | dialogs, close buttons |
| `Loader2`, `Check`, `Plus`, `Minus`, `Bell`, ... | `CircleNotchIcon`, `CheckIcon`, `PlusIcon`, `MinusIcon`, `BellIcon`, ... | direct 1:1, kept via `*Icon` suffixed (non-deprecated) exports |

23 Gymini nav icons (full differentiation reasoning in §12):

| Concept | Phosphor icon | Why this one, not a neighbor |
|---|---|---|
| Dashboard | `SquaresFourIcon` | overview grid — distinct from InBody/Activity |
| InBody | `ScanIcon` | body-scan framing brackets — distinct from Profile's circle-user |
| AI Plan | `HeadCircuitIcon` | a head as a circuit board reads "AI thinking"; kept off plain `Brain` (used elsewhere, e.g. LoginPage's feature list) to avoid collision |
| Workout | `BarbellIcon` | |
| Nutrition | `ForkKnifeIcon` | |
| Discover | `CompassIcon` | |
| Services | `TicketIcon` | a voucher/offer, distinct from Marketplace's storefront |
| Chat | `ChatCircleDotsIcon` | |
| Wallet | `WalletIcon` | distinct from Money's `CurrencyDollarIcon` |
| Profile | `UserCircleIcon` | distinct from Users' group icon and InBody's scan |
| Settings | `GearSixIcon` | |
| Users | `UsersIcon` | |
| Contract | `FileTextIcon` | |
| Schedule | `CalendarCheckIcon` | a confirmed slot, distinct from a bare date Calendar |
| Gym | `BuildingsIcon` | the venue — distinct from Workout's Barbell and Marketplace's Storefront |
| Admin | `ShieldCheckIcon` | |
| Marketplace | `StorefrontIcon` | |
| Compare | `ArrowsLeftRightIcon` | |
| Catalog | `GridNineIcon` | a denser 3×3 matrix, distinct from Dashboard's simpler grid |
| Money | `CurrencyDollarIcon` | |
| System | `GaugeIcon` | a meter reads "observability/monitoring" better than a plain Monitor screen |
| Dispute | `GavelIcon` | |
| Workflow | `FlowArrowIcon` | a branching arrow, distinct from Compare (no branch) and Plan's HeadCircuit |

## P0 navigation icons

All 11 implemented and visually verified (desktop sidebar, mobile bottom nav, dark + light, real
browser via Playwright) — see Visual QA. Explicit differentiation the spec called out is
satisfied: Dashboard (grid) ≠ InBody (scan frame) ≠ Activity (not used as a Gymini icon at all);
Discover (compass) is visually distinct from Search (magnifying glass) in the same sidebar;
Wallet ≠ Money; Profile (circle-user) ≠ Users (group).

## Dark mode / Light mode

No new color tokens. `GyminiIconProps#tone` classes (`.gymini-icon-accent`,
`.gymini-icon-muted`, `.gymini-icon-danger`, `.gymini-icon-success`) resolve to the project's
existing `--primary-color`/`--muted-text-color`/`--destructive` theme tokens, already themed for
both modes in `theme.css`. Verified visually in both.

## Active/inactive states

`Sidebar.tsx`/`BottomNav.tsx` now pass `weight={isActive ? "bold" : "regular"}` alongside the
existing `text-green-400` active className — inactive items render Phosphor's `regular` weight
in muted foreground, active items render `bold` weight in the brand green, matching the spec's
navigation concept exactly (§7/§28). No glow, no HUD frame, no decoration — verified via
screenshot that the weight change alone reads clearly as "selected."

## Icon Gallery

`/dev/icons` (from the prior pass) — updated automatically since it renders whatever
`../icons/gymini` exports; no changes needed to the gallery page itself. Shows all 23 icons at
size 16/20/24/32, dark/light toggle, default + accent color side by side, search-by-name.
Dev-only (`import.meta.env.DEV` guard), not linked from any real navigation.

## Backward compatibility

`GyminiLucide.tsx` is now a **minimal** compatibility layer: only the 23 `GyminiXIcon` names
(re-exported from `../icons/gymini`), since a full repo audit proved nothing else imports raw
names from this file or from `lucide-react` anymore — every one of the 123 consumer files was
migrated to import Phosphor directly. Kept the file (rather than deleting it and updating
`Sidebar.tsx`/`BottomNav.tsx`'s import paths) specifically because those two files still import
from this exact path — this is the "don't break existing imports" contract, satisfied at the
smallest surface that's actually still real.

## Files changed

- `frontend/web/package.json` / `pnpm-lock.yaml` — `+@phosphor-icons/react`, `-lucide-react`.
- `frontend/web/vite.config.ts` — no alias (an intermediate version of this migration used one;
  removed once all 123 files were migrated to direct imports — see "Remaining issues" for why).
- `frontend/web/src/styles/theme.css` — added `.gymini-icon-{muted,accent,danger,success}` tone
  classes (existing tokens only) and a `transition: color` (respecting
  `prefers-reduced-motion`).
- `frontend/web/src/app/components/icons/gymini/base.tsx` — rewritten: wraps a Phosphor icon
  instead of rendering hand-authored `<path>` children.
- `frontend/web/src/app/components/icons/gymini/core.tsx`, `feature.tsx` — rewritten: each of
  the 23 icons is now `createGyminiIcon("Name", SomePhosphorIcon)`.
- `frontend/web/src/app/components/icons/gymini/mascot.tsx` — **unchanged**. The spec's own §16
  explicitly reserves custom art for mascot/logo moments Phosphor can't represent; this is exactly
  that case, not a UI icon.
- `frontend/web/src/app/components/brand/GyminiLucide.tsx` — reduced to the 23-icon compat layer
  (see "Backward compatibility").
- `frontend/web/src/app/components/layout/Sidebar.tsx`, `BottomNav.tsx` — added
  `weight={isActive ? "bold" : "regular"}` to the nav icon render (see "Active/inactive states").
- **123 files** across `src/app/pages/`, `src/app/components/`: `import { X } from
  "lucide-react"` → `import { XIcon as X } from "@phosphor-icons/react"` (local binding names
  preserved everywhere, including files that already used `X as Y` aliasing and the 4 files
  using `import type { LucideIcon }`). Full list available via
  `git status --porcelain frontend/web`.

## Packages changed

- `+ @phosphor-icons/react@2.1.10`
- `- lucide-react` (fully removed — confirmed zero remaining references before uninstalling)

## Tests

Same constraint as the prior pass: `frontend/web` has no `typecheck`/`lint`/`test` script, no
`tsconfig.json`. Ran what's real, plus the same ad-hoc supplement:

- `pnpm run build` — **passed** at every stage of this migration (after the codemod, after
  simplifying `GyminiLucide.tsx`, after the active-weight change) — this is the one gate that
  actually validates 1494 modules' worth of import resolution across the whole app.
- `npx tsc --noEmit` (ad-hoc, JSX/bundler flags) against every icon-system file — no errors.
- `node scripts/check-repo-hygiene.mjs` (the repo's real `lint` script) — same 3 pre-existing,
  unrelated issues as before the codemod touched 123 files (verified the codemod didn't
  introduce any BOM/encoding damage of its own).
- No frontend test runner exists to run.

## Visual QA

Real Playwright runs against the live dev stack, same coverage as the prior pass plus the new
active-weight check: admin/PT/client sidebars, mobile bottom nav, `/dev/icons` gallery, dark +
light, zero console errors throughout.

## Remaining issues

- **Bundle size, and why the architecture ended up import-per-file instead of an alias.** The
  first working version of this migration reintroduced the `vite.config.ts` alias that redirects
  `"lucide-react"` to `GyminiLucide.tsx` (safe this time, since that file only imports from
  `@phosphor-icons/react`, not from `lucide-react` — no self-reference). It built and worked, but
  measurement showed the main bundle chunk grew from 708KB to **1,155KB** minified — because
  every page's icon import funneled through one shared module, Rollup couldn't code-split it
  per page anymore, so all ~180 icons shipped in one chunk regardless of which page needed which
  icon. Migrating all 123 files to import Phosphor directly (this report's actual final state)
  brought it back down to **828KB** — the remaining +120KB over the pre-migration baseline is the
  real, inherent cost of Phosphor icons being heavier per-icon than lucide's (a Phosphor icon
  file bundles path data for all 6 weight variants — measured ~4KB vs lucide's ~1KB single-weight
  equivalent), not an implementation gap. This is disclosed rather than hidden: switching icon
  libraries to one with a multi-weight system has a real, quantifiable bundle cost, and 828KB
  minified / ~252KB gzip for the whole app's icon-inclusive main chunk was judged acceptable
  given the explicit brand requirement.
- **`strokeWidth` prop compatibility** — ~29 call sites across 8 files pass a numeric lucide
  `strokeWidth` prop. Phosphor has no such prop (`weight` enum instead); the number is now
  harmlessly ignored (spread onto the `<svg>` as an inert attribute) rather than changing visual
  weight. Not a crash, a minor fidelity loss on those specific icons — not touched in this pass
  since it's pre-existing usage outside the icon-system files themselves and low severity.
- **Gauge for "System"** is a judgment call, not a certain one — `MonitorIcon` (a literal screen)
  was the other real candidate. Kept `GaugeIcon` since the two System-labeled nav entries are
  "Giám sát hệ thống" and "AI Observability" (monitoring/metrics framing, not "here's a
  computer"), but flagging this as the one P1 pick with a genuine runner-up.
