/**
 * ND-05 — the catalog-quality matrix printed the raw licence codes stored by the importers
 * ("UNDOCUMENTED_DO_NOT_RELY_ON", "original_curated"). The admin should read what they mean; an
 * unknown internal-looking code is shown as "chưa rõ" rather than leaked. Real licence names
 * ("CC0", "MIT", "CC-BY-4.0") pass through unchanged.
 */
const LICENSE_VI: Record<string, string> = {
  original_curated: "Nội dung gốc do Gymini biên soạn",
  Unlicense: "Phạm vi công cộng (Unlicense)",
  UNDOCUMENTED_DO_NOT_RELY_ON: "chưa xác định giấy phép",
};

/** Looks like an internal code: has an underscore and no spaces ("some_code", "SOME_CODE"). */
const INTERNAL_CODE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/;

export function licenseLabelVi(value: string | null | undefined): string | null {
  if (!value) return null;
  const known = LICENSE_VI[value];
  if (known) return known;
  return INTERNAL_CODE.test(value) ? "chưa rõ" : value;
}

/** "dữ liệu / hình-video" line of the matrix. */
export function licenseSummaryVi(dataLicense: string | null | undefined, mediaLicense: string | null | undefined): string {
  const data = licenseLabelVi(dataLicense) ?? "—";
  const media = licenseLabelVi(mediaLicense);
  return `${data} / ${media ?? "chưa có giấy phép hình/video"}`;
}
