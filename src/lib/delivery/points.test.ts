import { describe, expect, it } from "vitest";
import { hasPointCoordinates, type PickupPoint } from "./points";

const point: PickupPoint = { id: "42", name: "ПВЗ", address: "Адрес", type: "pvz", latitude: 44.99, longitude: 38.95 };
describe("pickup map coordinates", () => {
  it("uses actual coordinates only", () => {
    expect(hasPointCoordinates(point)).toBe(true);
    for (const coordinates of [{ latitude: null }, { longitude: null }, { latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: -181 }, { latitude: 0, longitude: 0 }]) {
      expect(hasPointCoordinates({ ...point, ...coordinates })).toBe(false);
    }
  });
});
