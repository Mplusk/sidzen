// Carrier addresses arrive as a single display string, not as structured city fields.
const street = /^(?:(?:ул|пер|просп|наб|пл|мкр)\.\s*|(?:ул|пер|наб|пл)\s+|(?:улица|переулок|проспект|шоссе|проезд|бульвар|набережная|площадь|аллея|тупик|тракт|микрорайон)\s+|(?:пр-т|пр-кт|б-р)\s*)/iu;
const locality = /^(?:город\s+|г\.\s*|г\s+|пос[её]лок\s+|пос\.\s*|пгт\.?\s+|село\s+|с\.\s*|деревня\s+|д\.\s*|станица\s+|ст-ца\s+)(.+)$/iu;
const area = /(?:^|[\s.])(?:область|обл|край|республика|респ|район|р-н|округ|автономный|поселение|территория)(?:$|[\s.])/iu;

function isLocality(value: string) {
  return value.length <= 100
    && /^[\p{L}][\p{L}\s.'’\-]*$/u.test(value)
    && !/^(?:россия|рф|российская федерация)$/iu.test(value)
    && !area.test(value)
    && !street.test(value);
}

export function destinationCity(address: string | null, provider?: string | null): string | null {
  if (!address || /^самовывоз(?:\s|,|$)/iu.test(address.trim())) return null;
  const parts = address.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const streetIndex = parts.findIndex(part => street.test(part));
  const beforeStreet = streetIndex < 0 ? parts : parts.slice(0, streetIndex);
  for (const part of beforeStreet) {
    const value = locality.exec(part)?.[1].trim();
    if (value && isLocality(value)) return value;
  }
  if (provider === "ozon-delivery" || provider === "cdek-delivery") {
    if (streetIndex < 1) return null;
    return beforeStreet.reverse().find(isLocality) ?? null;
  }
  // Other checkout methods save the city first, optionally after a postal code.
  const candidate = parts[/^\d{6}$/.test(parts[0]) ? 1 : 0];
  return candidate && isLocality(candidate) ? candidate : null;
}
