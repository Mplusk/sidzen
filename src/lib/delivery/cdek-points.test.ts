import { expect, it, vi } from "vitest";
import { checkedCdekPoint } from "./cdek-points";
import type { CdekDeliveryClient } from "./cdek-client";

it("rejects a different or incompatible pickup point even if the carrier suggests one", async () => {
  const point = { code: "PVZ1", name: "Point", status: "ACTIVE", is_handout: true, type: "PVZ", location: { city_code: 44, address_full: "Test address" } };
  const api = { authorize: vi.fn(), deliveryPoint: vi.fn().mockResolvedValue([point]) } as unknown as CdekDeliveryClient;
  const parcel = { weight: 1000, length: 20, width: 10, height: 5 };
  expect((await checkedCdekPoint(api, "PVZ1", 44, [parcel])).code).toBe("PVZ1");
  await expect(checkedCdekPoint(api, "OTHER", 44, [parcel])).rejects.toThrow("point");
  await expect(checkedCdekPoint(api, "PVZ1", 45, [parcel])).rejects.toThrow("point");
});
