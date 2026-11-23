/**
 * Gym Owner redesign flag (batch G0). The ONLY place that reads VITE_GYM_OWNER_V2.
 * Off (default) = /gym-owner/* renders in the legacy AppShell exactly as before.
 * On            = /gym-owner/* renders in GymOwnerShell (pages inside are still the existing ones).
 */
export function isGymOwnerV2Enabled(): boolean {
  // `import.meta.env` is undefined when this file runs under `tsx --test` (Node), hence the optional chaining.
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GYM_OWNER_V2;
  return raw === "true" || raw === "1";
}
