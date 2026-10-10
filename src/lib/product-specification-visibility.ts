// Classification codes are retained in storage/editor, never rendered on the
// storefront. Normalize importer/manual spelling, separators and whitespace.
export function isAdminOnlySpecification(label: string) {
  const normalized = label.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]/gu, "");
  return /(?:тнвэд|tnved|окпд|okpd)/u.test(normalized);
}
