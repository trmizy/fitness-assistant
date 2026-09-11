---
name: gymini-ui-information-architecture
description: Creating or changing a page, tab, nav item, dashboard, wizard, modal, or drawer in Gymini's frontend. Load for any navigation/IA decision or mobile-layout work, especially around Training/Roadmap/PT surfaces.
---

# Gymini UI Information Architecture

## User mental model over database model

Avoid exposing `RoadmapPhase`, `TrainingCycle`, `NutritionGoal`, or other
internal enum/entity names as navigation concepts a user has to
understand. Prefer:

```
one main surface -> summary -> drill-down
```

over:

```
one backend entity = one page
```

## Training surface (current, don't regress)

```
Nhật ký tập   (today/log)
Lộ trình      (Journey — Roadmap/Phase/Cycle live INSIDE this surface as
               drill-down/detail, not as separate top-level nav items)
```

`TrainingCyclePage.tsx` remains a drill-down destination, not a primary
nav item, unless a later explicit product decision changes this — check
`routes.tsx` before assuming otherwise.

## Roadmap surface

Do not create standalone top-level pages for: diagnosis, projection,
phase detail, forecast, or assessment — these are sections/cards inside
the Journey surface, reached by drill-down, unless a real, proven
navigation need is demonstrated (not assumed).

## PT Coaching Workspace (current precedent, already built)

`PTClientDetail.tsx` is ONE tabbed coaching hub — Tổng quan / Tập luyện
/ Dinh dưỡng / Tiến độ / Lịch sử — not a page per entity
(Roadmap/Cycle/Nutrition/InBody/Assessment). Each tab lazy-loads its own
detail on activation (the "Tiến độ"/InBody tab specifically must not be
fetched up front with the Overview call — see
`docs/GYMINI_PT_COACHING_IMPLEMENTATION_REPORT.md` for the exact
pattern: a `section` prop on a shared component reusing one query,
rather than a second component with a duplicate query). Use this as the
template for any future PT surface, and for any client surface facing
the same "many related entities, one workspace" shape.

## Mobile-first — required breakpoints

Test **360, 375, 390, 412** on every touched surface:

- horizontal overflow (`document.documentElement.scrollWidth -
  clientWidth` should be `<= 1`)
- sticky action bar / bottom-nav overlap
- touch target size
- long Vietnamese label wrapping (Vietnamese strings run longer than
  their English equivalents — a layout that works in English can
  overflow in Vietnamese)
- loading / empty / error states specifically at small widths
- dark AND light theme (see below)

Use cards/stacked summaries on mobile, not a desktop-shaped table
squeezed down — `PTClientList.tsx` already has this exact pattern
(a `hidden md:block` table + a `md:hidden` card list) — reuse it rather
than inventing a new responsive table approach.

## Dark / light theme

Reuse Gymini's existing design tokens (the `zinc-*`/`green-*`/`amber-*`
etc. Tailwind classes already used throughout `pages/client` and
`pages/pt`) — never introduce a one-off hardcoded color. Toggle
`document.documentElement.setAttribute('data-theme', 'light'|'dark')`
and confirm `getComputedStyle(document.body).backgroundColor` is never
transparent/unstyled in either mode — this is the real, established
test pattern (`tests/31-fitness-roadmap.spec.ts`'s TC-ROADMAP-003,
`tests/33-pt-coaching-workspace.spec.ts`'s TC-PT-011).

## Definition of correct behavior

A user can reach any piece of information through the primary
surface + drill-down, without memorizing a specific backend entity's
name. Every touched surface renders with 0px horizontal overflow at all
four required breakpoints, in both themes.

## Common failure modes

- One new page per backend concept ("page explosion") instead of a tab
  or drill-down inside an existing workspace.
- A generic-admin-dashboard look (giant unstyled tables, default browser
  form controls) instead of Gymini's actual card/rounded-corner/dark
  visual identity ("AI slop" — avoid it).
- Testing only desktop width, or only dark theme, and calling a surface
  "mobile-tested"/"theme-tested" without the other half actually
  checked.
- Fetching a tab's heavy detail data before the tab is ever opened.
