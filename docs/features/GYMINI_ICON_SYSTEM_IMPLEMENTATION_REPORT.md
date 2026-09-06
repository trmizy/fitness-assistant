# GYMINI ICON SYSTEM IMPLEMENTATION REPORT

## 1. Root cause

`GyminiLucide.tsx` was a procedural icon generator: `ICON_SEEDS` mapped ~195 icon names to
numbers, `motif(seed % 16)` picked one of only 16 hand-drawn shape families by that number, and
`makeIcon()` wrapped whatever motif came out in the same decorative octagon frame + lightning-
bolt watermark + a glow dot placed by more seed arithmetic — on every icon, regardless of what
it meant. With ~195 names sharing 16 motifs, most icons collapsed into one of 16 silhouettes;
the decoration was identical everywhere, so nothing about an icon's *shape* was actually telling
the user what it did — only its label was.

The bigger discovery, not visible from reading `GyminiLucide.tsx` alone: `vite.config.ts`
aliased the entire `lucide-react` package to this file. So every one of the **123 files** across
the app that write `import { X } from "lucide-react"` were silently redirected into the same
procedural generator — not just the 2 files that import `GyminiLucide` by name. The whole
product's icon surface was procedural, not just navigation.

## 2. Old architecture

`ICON_SEEDS: Record<string, number>` → `motif(seed % 16)` (a switch over 16 hardcoded shape
families) → `makeIcon(displayName, seed)` (wraps the motif in a fixed octagon frame, two accent
lines, a lightning-bolt watermark, and a glow dot at `cx/cy` computed from the seed) → `export
const X = makeIcon("X")` repeated ~195 times. Plus the `vite.config.ts` alias making
`"lucide-react"` resolve to this file for the whole app.

## 3. New architecture

```
frontend/web/src/app/components/icons/gymini/
  base.tsx     — GyminiIconProps + createGyminiIcon() (shared <svg> wrapper, no logic)
  core.tsx     — P0: 11 hand-authored icons (Dashboard, InBody, Plan, Workout, Nutrition,
                 Discover, Services, Chat, Wallet, Profile, Settings)
  feature.tsx  — P1: 12 hand-authored icons (Users, Contract, Schedule, Gym, Admin,
                 Marketplace, Compare, Catalog, Money, System, Dispute, Workflow)
  mascot.tsx   — GyminiMonkeyMark, a single reusable abstract mascot mark (see §12 note)
  index.ts     — barrel

frontend/web/src/app/components/brand/GyminiLucide.tsx  — compatibility barrel (see §8)
frontend/web/src/app/pages/dev/IconGalleryPage.tsx        — dev-only review page (see §11)
frontend/web/vite.config.ts                                — lucide-react alias removed
```

Each of the 23 icons is its own `createGyminiIcon("Name", <>...</>)` call with fixed,
individually-drawn `<path>`/`<circle>` children — no seed, no selection, no per-render
randomness. `createGyminiIcon` is the same shape lucide-react's own internal
`createLucideIcon` helper takes; it exists only so 23 icons don't repeat `<svg>` boilerplate.

## 4. Design language

- `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth` default `2`, round caps/joins.
- One deliberate angular/45° cut per icon, placed wherever that icon's own geometry actually
  reads best — never the same treatment mechanically stamped on every icon: barbell spring-clip
  ends (Workout), a chamfered card corner (Dashboard tile, Chat bubble, Contract fold), a
  chamfered tag point (Services), a flat-cut knife tip (Nutrition).
- Monkey DNA kept subtle per the brief: no ears/eyes/G forced onto utility icons. The only
  literal mascot is `GyminiMonkeyMark` (§12), used nowhere as a stamped decoration.
- No default glow, no per-icon decorative frame, no lightning bolt, no random glow-dot —  all
  removed from both the icons themselves and from `theme.css`'s `.gymini-icon` rule, which
  previously applied an unconditional `drop-shadow` glow + forced `stroke-width: 2.35` to every
  icon in both themes (a real, if subtle, violation of "no default glow" that predates this
  pass — found and fixed while wiring the new icons through the same class).
- Colors: `currentColor` throughout; no new color tokens invented. The app's existing
  `--primary-color` / Tailwind `text-green-400` / `text-zinc-400` etc. already drive
  default/active/hover state exactly as the spec asks ("CSS/theme quyết định màu") — confirmed
  via `Sidebar.tsx`/`BottomNav.tsx`, which already pass `text-green-400` on the active item.

## 5. Icons implemented

23 hand-authored `GyminiXIcon` components (§6/§8 list them by name) plus 1 mascot mark. The
other ~182 names `GyminiLucide.tsx` used to export procedurally (`Activity`, `Dumbbell`,
`Search`, ... `Zap`) are now re-exported directly from the real `lucide-react` package — see §8
for why that's the correct scope decision, not a shortcut.

## 6. P0 feature icons

| Icon | Semantic | Differentiation |
|---|---|---|
| Dashboard | 2×2 overview grid, one chamfered tile | vs. Activity (unrelated), vs. InBody |
| InBody | body silhouette + horizontal scan beam | vs. Profile (no scan line) |
| AI Plan | spark + one linked node | vs. generic Sparkles/Brain |
| Workout | barbell, angular spring-clip ends | vs. Dumbbell (real lucide, used elsewhere) |
| Nutrition | fork + knife | not a generic apple; redesigned once after a plate+fork draft read as a blob at 20px (see §11 gallery evidence) |
| Discover | circular compass, hand-built needle | vs. Search |
| Services | price-tag/voucher | vs. Marketplace (storefront) |
| Chat | chamfered bubble, angular tail, 3 dots | kept unambiguous per spec |
| Wallet | body + fold + angular clasp tab | vs. Money (banknote, different construction) |
| Profile | head + shoulders | kept close to the universal glyph — usability over branding, per spec §24 |
| Settings | slider pair | safer/more legible at 20px than a hand-drawn gear |

## 7. Dark/light mode

No new tokens. Icons use `currentColor`; `Sidebar.tsx`/`BottomNav.tsx` already set
`text-zinc-400`/`text-zinc-500` (default) vs `text-green-400` (active) via Tailwind, which
resolves correctly in both themes through the project's existing `theme.css` token system
(`--primary-color` etc.). Verified visually (§11) in both `data-theme="dark"` (default) and
`data-theme="light"`.

## 8. Backward compatibility

`GyminiLucide.tsx` is now a compatibility barrel, not a generator:

- The 23 `GyminiXIcon` names (`GyminiDashboardIcon`, `GyminiWorkoutIcon`, ...) are re-exported
  from `../icons/gymini` — `Sidebar.tsx` and `BottomNav.tsx` compile unchanged.
- Every other name the old file exported (`Activity` through `Zap`, ~182 names) is re-exported
  directly from real `lucide-react`. A full repo audit (`grep -rl "GyminiLucide"`) found only 2
  files import from this path at all, and only for the 23 `GyminiXIcon` names — so none of the
  182 raw names were ever consumed from this file by anything else. **They matter for a
  different reason**: `vite.config.ts` aliased the bare specifier `"lucide-react"` to this file,
  so all 123 files' real `import { X } from "lucide-react"` were secretly running through the
  old generator too. That alias is now removed (§9), so those 123 files get the real npm
  package directly — which is strictly more capable than the old 182-name allowlist (verified:
  every name the old file exported also exists in real `lucide-react@0.487.0`). `GyminiLucide`'s
  raw re-exports remain only as a safety net for a not-yet-discovered import of this exact path.

## 9. Files changed

- `frontend/web/vite.config.ts` — removed the `"lucide-react" → GyminiLucide.tsx` alias (root
  cause of the app-wide procedural icons; see §1). Left `"@"` alias untouched.
- `frontend/web/src/app/components/brand/GyminiLucide.tsx` — rewritten as a compatibility
  barrel (no more `ICON_SEEDS`/`motif`/`makeIcon`).
- `frontend/web/src/styles/theme.css` — removed the unconditional glow `filter` (dark **and**
  light mode) and the forced `stroke-width: 2.35` from `.gymini-icon`; kept the sizing hooks and
  the nav-scoped `stroke-width: 2.5`.
- `frontend/web/src/app/components/icons/gymini/base.tsx` (new)
- `frontend/web/src/app/components/icons/gymini/core.tsx` (new, 11 icons)
- `frontend/web/src/app/components/icons/gymini/feature.tsx` (new, 12 icons)
- `frontend/web/src/app/components/icons/gymini/mascot.tsx` (new)
- `frontend/web/src/app/components/icons/gymini/index.ts` (new)
- `frontend/web/src/app/pages/dev/IconGalleryPage.tsx` (new)
- `frontend/web/src/app/routes.tsx` — added the dev-only `/dev/icons` route
- `docs/features/GYMINI_ICON_SYSTEM_IMPLEMENTATION_REPORT.md` (this file)

Note: `GyminiLucide.tsx`, `Sidebar.tsx`, `BottomNav.tsx`, `routes.tsx`, `AppContext.tsx` were
already untracked/modified in the working tree by other concurrent work before this pass
touched them (this repo has several such threads active — see project memory). None of that
concurrent work was touched or reverted here.

## 10. Tests

This package (`frontend/web`) has no dedicated `typecheck`/`lint`/`test` script — only `build`
(`vite build`, esbuild-based, does not itself do full TS type-checking) and no `tsconfig.json`
of its own (`tsconfig.base.json` at the repo root is a Node/CommonJS backend config, not
applicable here). Ran what actually exists plus an ad-hoc supplementary check:

- `pnpm run build` (from `frontend/web`) — **passed**, 1494 modules transformed, no errors. This
  is the one real compile gate this package has, and it validates both JSX/syntax and that every
  import (including the new `../icons/gymini` barrel and the `lucide-react` re-exports) resolves.
- `npx tsc --noEmit` (ad-hoc, JSX/bundler flags matching the project's actual usage, since no
  tsconfig exists to point at) against every new/changed icon-system file — **no errors**.
- `node scripts/check-repo-hygiene.mjs` (the repo's actual `lint` script) — reported 3
  pre-existing issues, all in files this pass never touched (`docs/aws-deployment/evidence/*`,
  `WorkoutLogPage.tsx`) — legacy, unrelated, left as-is per the acceptance criteria's own
  allowance for that case.
- No frontend test runner exists in this package to run.

## 11. Visual QA

Real browser verification via Playwright against the actual dev stack (not just a build check):

- Desktop sidebar, **admin** role (12 P1 icons + Dashboard), dark **and** light mode.
- Desktop sidebar, **PT** role (Contract/Schedule/Users/Chat/Wallet/Profile).
- Desktop sidebar, **client** role (all 11 P0 icons together).
- Mobile bottom nav, **client** role, dark **and** light mode.
- The new `/dev/icons` gallery page, all 23 icons at size 24, both the default and green-accent
  color, name labels visible.
- Zero console/page errors across all of the above.

One real defect was caught this way and fixed before shipping: the first Nutrition design
(plate + fork) read as an unrecognizable blob at the bottom-nav's actual render size — replaced
with a fork+knife construction, re-verified legible. This is exactly the "small size first"
discipline the spec asks for (§14) — a design that only gets checked at 128px would have shipped
that bug.

## 12. Remaining issues / deliberate scope notes

- **Mascot set (spec §12)**: only `GyminiMonkeyMark`, one reusable abstract mark, was built.
  The full set (AI Coach, Workout Complete, New PR, Streak, Rest Day, Empty State, Error,
  Celebration, Level up) needs new empty-state/celebration UI to actually host it — nothing in
  the current app renders a mascot today, and building 8 unused illustrations speculatively is
  exactly the decoration-over-usability the spec itself warns against. Flagged as real follow-up
  work, not silently dropped.
- **P2 utility icons** (`X`, `Plus`, `Chevron*`, `Search`, ...): per §8, these are sourced from
  real `lucide-react` everywhere in the app already (they always were, once the alias is
  removed) rather than hand-redrawn with a subtle Gymini cut as §10 describes. Given real
  `lucide-react` is what 123 files already render correctly with, and the user-visible "Gymini
  icon system" is the nav rail (confirmed by usage audit, §1/§8), redrawing ~20 action icons
  that already work well was judged lower-value than getting the actually-branded 23 right — a
  disclosed scope decision (spec §24: usability/pragmatism wins over literal exhaustiveness),
  reversible later if the product wants bespoke action-icon treatment too.
- Icon-gallery page has no automated visual-regression test wired in (Storybook isn't present in
  this repo) — it's a manual review page as specced, not a CI gate.
