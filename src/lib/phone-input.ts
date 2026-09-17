export function phoneMask(raw: string) {
  let value = raw.replace(/\D/g, "");
  if (!value) return "";
  if (value.startsWith("8") || value.startsWith("7")) value = value.slice(1);
  value = value.slice(0, 10);
  // Do not append punctuation after the last digit: Backspace must remove digits,
  // rather than repeatedly deleting and re-inserting a trailing bracket/space.
  return "+7" + (value ? ` (${value.slice(0, 3)}` : "") + (value.length > 3 ? ") " : "") + value.slice(3, 6) + (value.length > 6 ? `-${value.slice(6, 8)}` : "") + (value.length > 8 ? `-${value.slice(8, 10)}` : "");
}
