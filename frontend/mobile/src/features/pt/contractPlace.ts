/** Public name + address of the gym branch a contract runs at, as `/contracts/pt` reports it (`gymInfo`). */
export type ContractGymInfo = { id: string; name: string; address?: string | null; city?: string | null };

/** "<branch> — <address>" for a PT's contract card; null when the contract has no gym branch or it is unknown. */
export function contractPlaceLabel(gymInfo: ContractGymInfo | null | undefined): string | null {
  const name = gymInfo?.name?.trim();
  if (!name) return null;
  const address = gymInfo?.address?.trim();
  return address ? `${name} — ${address}` : name;
}
