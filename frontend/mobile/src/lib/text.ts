// Pure (no React Native) so feature modules and node tests can use it; SelectSheet re-exports it.
/** Accent-insensitive match, so "ha noi" finds "Hà Nội". */
export function foldVi(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
}
