export type PickupPoint = { id: string; name: string; address: string; type: string; latitude: number | null; longitude: number | null };

export function hasPointCoordinates(point: PickupPoint): point is PickupPoint & { latitude: number; longitude: number } {
  return point.latitude !== null && point.longitude !== null && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 && !(point.latitude === 0 && point.longitude === 0);
}
