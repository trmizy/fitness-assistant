/**
 * A media reference from the API → something an image component can load. Storage-backed
 * deployments answer absolute (signed) URLs; disk-backed ones answer a path on the gateway
 * ("/uploads/profile-photos/…"). Web resolves such a path against its own origin for free; a
 * native image view has no origin, so the path loaded nothing and an uploaded avatar showed as an
 * empty circle (real phone, 7/10). `base` is the gateway address in use.
 */
export function resolveMediaUri(uri: string | null | undefined, base: string): string | null {
  const value = uri?.trim();
  if (!value) return null;
  if (/^(https?|file|content|data|blob):/i.test(value)) return value;
  return `${base.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}
