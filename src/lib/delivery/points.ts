export type PickupPoint = { id: string; name: string; address: string; type: string; latitude: number | null; longitude: number | null; distanceKm?: number };

export function hasPointCoordinates(point: PickupPoint): point is PickupPoint & { latitude: number; longitude: number } {
  return point.latitude !== null && point.longitude !== null && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 && !(point.latitude === 0 && point.longitude === 0);
}

export function initialMapPoints(points: PickupPoint[]) {
  const located = points.filter(hasPointCoordinates);
  if (located.length < 3) return located;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const nearby = (a: typeof located[number], b: typeof located[number]) => {
    const h = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h))) <= 30;
  };
  const largest = located.reduce((best, anchor) => {
    const group = located.filter(point => nearby(anchor, point));
    return group.length > best.length ? group : best;
  }, [] as typeof located);
  // A settlement name can also occur in a distant street or district name.
  // Focus an unambiguous majority without removing any other selectable PVZ.
  return largest.length > located.length / 2 ? largest : located;
}
