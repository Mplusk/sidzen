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
  // A city name may also match an entire region and unrelated streets across
  // the country. A clear plurality can identify the city even without 50% of
  // all results. Keep ambiguous clusters together rather than guessing.
  if (largest.length <= located.length / 2) {
    if (largest.length < 3 || largest.length < located.length * 0.25) return located;
    const selected = new Set(largest);
    let runnerUp = 0;
    for (let index = 0; index < anchorCount; index++) {
      const anchorIndex = anchorCount === located.length ? index : Math.floor(index * (located.length - 1) / (anchorCount - 1));
      const anchor = coordinates[anchorIndex];
      let count = 0;
      for (const candidate of coordinates) {
        if (selected.has(candidate.point)) continue;
        const h = Math.sin((candidate.latitude - anchor.latitude) / 2) ** 2 + anchor.cosLatitude * candidate.cosLatitude * Math.sin((candidate.longitude - anchor.longitude) / 2) ** 2;
        if (h <= maxDistance) count++;
      }
      runnerUp = Math.max(runnerUp, count);
    }
    if (largest.length <= 2 * runnerUp) return located;
  }
  // The 30 km neighbourhood can still include distant suburbs. For a large,
  // unambiguous settlement, fit its central 90% on each axis. This only
  // changes the opening view: every point is still drawn and selectable.
  if (largest.length < 40) return largest;
  const latitudes = largest.map(point => point.latitude).sort((a, b) => a - b);
  const longitudes = largest.map(point => point.longitude).sort((a, b) => a - b);
  // On either edge, stop before a geographically separated satellite town.
  // Require a meaningful physical gap as well as a gap relative to the city;
  // this leaves continuous, elongated cities unchanged.
  const edgeBounds = (values: number[], kmPerDegree: number) => {
    const last = values.length - 1;
    let low = Math.floor(last * 0.05);
    let high = Math.ceil(last * 0.95);
    const middleLow = Math.floor(last * 0.2);
    const middleHigh = Math.ceil(last * 0.8);
    const coreWidth = values[Math.floor(last * 0.75)] - values[Math.floor(last * 0.25)];
    const separated = (gap: number) => gap * kmPerDegree >= 3 && gap > coreWidth * 0.25;
    for (let index = low; index < middleLow; index++) {
      if (separated(values[index + 1] - values[index])) low = index + 1;
    }
    for (let index = high - 1; index >= middleHigh; index--) {
      if (separated(values[index + 1] - values[index])) high = index;
    }
    return [values[low], values[high]] as const;
  };
  const [minLat, maxLat] = edgeBounds(latitudes, 111);
  const [minLon, maxLon] = edgeBounds(longitudes, 111 * Math.cos(radians(latitudes[Math.floor(latitudes.length / 2)])));
  return largest.filter(point => point.latitude >= minLat && point.latitude <= maxLat && point.longitude >= minLon && point.longitude <= maxLon);
}
