/** Where a contract's sessions run, as `/contracts/pt` reports it (`gymInfo`: public name + address of the chosen branch). */
export interface ContractGymInfo {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
}

/** "Nơi tập" text for a PT's contract card: "<branch> — <address>", or null when the contract has no gym branch / it is unknown. */
export function contractPlaceLabel(gymInfo: ContractGymInfo | null | undefined): string | null {
  const name = gymInfo?.name?.trim();
  if (!name) return null;
  const address = gymInfo?.address?.trim();
  return address ? `${name} — ${address}` : name;
}
