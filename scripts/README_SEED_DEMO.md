# Demo Seed Script for Fitness Assistant

## Purpose

This script creates realistic demo data for app walkthroughs and UI demos while preserving existing auth data.
It is idempotent for demo data: you can run it multiple times without endless duplicate growth.

Script file:
- scripts/seed-demo-fitness.ts

## What it seeds

- Demo users in `users` (upsert by email)
- Demo profiles in `user_profiles` (upsert by userId)
- Demo exercises in `exercises` (re-seeded with a demo marker)
- Demo workout plans in `workout_plans`
- Demo workouts in `workouts`
- Demo workout exercise links in `workout_exercises`
- Demo nutrition logs in `nutrition_logs`
- Demo AI conversations in `conversations`
- Demo audit logs in `audit_logs`

## Safety and idempotency

- Existing non-demo users are not removed.
- The script does not touch `refresh_tokens` or `email_verifications`.
- Demo users are identified by emails under `demo.*@fitassistant.local`.
- For idempotency:
  - users/profiles use upsert
  - existing demo workout/nutrition/plan/conversation/audit data is cleaned and rebuilt
  - demo exercises are identified with marker URL prefix and rebuilt

## Run command

From project root:

```bash
pnpm tsx scripts/seed-demo-fitness.ts
```

Equivalent:

```bash
npx tsx scripts/seed-demo-fitness.ts
```

## Environment requirements

- `.env` at project root with `DATABASE_URL`
- Database should be reachable
- Prisma clients should be generated (already present in this project)

## Demo accounts for login testing

All demo accounts use the same password:
- `Demo@12345`

Accounts:
- demo.admin@fitassistant.local (ADMIN)
- demo.pt@fitassistant.local (PT, profile has `isPT = true`)
- demo.user1@fitassistant.local .. demo.user8@fitassistant.local (CUSTOMER)

## Re-seed safely

Run the same command again:

```bash
pnpm tsx scripts/seed-demo-fitness.ts
```

The script will refresh demo-only data and keep real user auth data intact.
