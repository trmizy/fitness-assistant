# Fitness Assistant Web

The web client is a React 18 + Vite + TypeScript application for four role-based
workspaces: customer, personal trainer, gym owner, and administrator.

## Main Routes

- `/client`: dashboard, onboarding, InBody, AI plans/chat, workouts, nutrition,
  coaches, contracts, wallet, gyms, and profile
- `/pt`: dashboard, clients, contracts, plan review, schedule, chat, wallet, and
  profile
- `/gym-owner`: gym management
- `/admin`: users, PT applications, marketplace moderation, system health, n8n,
  and AI observability

## Run Locally

From the repository root:

```powershell
pnpm install
pnpm --filter @gym-coach/web dev
```

The client opens at `http://localhost:5173`. By default, Vite proxies API and
Socket.IO traffic to the local gateway/chat service; avoid setting absolute
`VITE_*` URLs unless the browser must bypass that same-origin proxy.

```powershell
pnpm --filter @gym-coach/web build
```

For the complete stack and seeded accounts, use the
[development setup](../../docs/setup/README.md).
