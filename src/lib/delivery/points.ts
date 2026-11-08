export type PickupPoint = { id: string; name: string; address: string; type: string; latitude: number | null; longitude: number | null };

export function hasPointCoordinates(point: PickupPoint): point is PickupPoint & { latitude: number; longitude: number } {
  return point.latitude !== null && point.longitude !== null && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 && !(point.latitude === 0 && point.longitude === 0);
}

export function initialMapPoints(points: PickupPoint[]) {
  const located = points.filter(hasPointCoordinates);
  if (located.length < 3) return located;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const coordinates = located.map(point => ({ point, latitude: radians(point.latitude), longitude: radians(point.longitude), cosLatitude: Math.cos(radians(point.latitude)) }));
  const maxDistance = Math.sin(30 / (2 * 6371)) ** 2;
  // Larger city results use at most 64 evenly spaced anchors: O(64 * n).
  // Only the initial camera focus is approximate; all points remain selectable.
  const anchorCount = located.length <= 200 ? located.length : 64;
  let largest: typeof located = [];
  for (let index = 0; index < anchorCount; index++) {
    const anchorIndex = anchorCount === located.length ? index : Math.floor(index * (located.length - 1) / (anchorCount - 1));
    const anchor = coordinates[anchorIndex];
    const group = coordinates.filter(candidate => {
      const h = Math.sin((candidate.latitude - anchor.latitude) / 2) ** 2 + anchor.cosLatitude * candidate.cosLatitude * Math.sin((candidate.longitude - anchor.longitude) / 2) ** 2;
      return h <= maxDistance;
    }).map(candidate => candidate.point);
    if (group.length > largest.length) largest = group;
    if (largest.length === located.length) break;
  }
  // A settlement name can also occur in a distant street or district name.
  // Focus an unambiguous majority without removing any other selectable PVZ.
  return largest.length > located.length / 2 ? largest : located;
}
