import { describe, expect, it } from "vitest";
import { hasPointCoordinates, initialMapPoints, type PickupPoint } from "./points";

const point: PickupPoint = { id: "42", name: "ПВЗ", address: "Адрес", type: "pvz", latitude: 44.99, longitude: 38.95 };
describe("pickup map coordinates", () => {
  it("uses actual coordinates only", () => {
    expect(hasPointCoordinates(point)).toBe(true);
    for (const coordinates of [{ latitude: null }, { longitude: null }, { latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: -181 }, { latitude: 0, longitude: 0 }]) {
      expect(hasPointCoordinates({ ...point, ...coordinates })).toBe(false);
    }
  });
  it("focuses the main settlement rather than a same-name distant district", () => {
    const main = [point, { ...point, id: "43", latitude: 44.98, longitude: 38.96 }, { ...point, id: "44", latitude: 44.97, longitude: 38.98 }];
    const other = { ...point, id: "45", latitude: 52.9, longitude: 38.7 };
    expect(initialMapPoints([...main, other])).toEqual(main);
  });
  it("does not arbitrarily hide an equal split or discard available coordinates", () => {
    const points = [point, { ...point, id: "43" }, { ...point, id: "44", latitude: 52.9 }, { ...point, id: "45", latitude: 52.9 }];
    expect(initialMapPoints(points)).toEqual(points);
    expect(initialMapPoints([point, { ...point, latitude: null }])).toEqual([point]);
  });
});
