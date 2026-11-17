/**
 * N13I-04: the owner / manager member list shows the member's display name when the server supplies one (`clientName`,
 * only sent to OWNER / MANAGER); until a row has it, the short id stays — a name is never invented.
 */
export function memberLabel(clientId: string | null | undefined, clientName?: string | null): string {
  const name = (clientName ?? "").trim();
  if (name) return name;
  const id = (clientId ?? "").trim();
  return id ? `${id.slice(0, 8)}...` : "Hội viên";
}
