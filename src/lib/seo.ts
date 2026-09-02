export function normalizePageTitle(value: string) {
  return value.replace(/\s*(?:\||—|-)\s*3DPRINTA\s*$/i, "").trim();
}
