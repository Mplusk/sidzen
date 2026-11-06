import { describe, expect, it } from "vitest";
import { dashboardDeliveryCost } from "./dashboard-delivery-cost";

describe("dashboard delivery cost", () => {
  it("compares the carrier quote with the goods subtotal", () => {
    expect(dashboardDeliveryCost("120", "240")).toEqual({ amount: 120, share: "50 %" });
    expect(dashboardDeliveryCost("264", "240")).toEqual({ amount: 264, share: "110 %" });
    expect(dashboardDeliveryCost("99.99", "240")).toEqual({ amount: 99.99, share: "41,7 %" });
  });

  it("handles free delivery and very small shares without rounding them to zero", () => {
    expect(dashboardDeliveryCost(0, 240)).toEqual({ amount: 0, share: "0 %" });
    expect(dashboardDeliveryCost(0.01, 1000)).toEqual({ amount: 0.01, share: "<0,1 %" });
  });

  it("does not invent a cost or divide by zero", () => {
    expect(dashboardDeliveryCost(null, 240)).toBeNull();
    expect(dashboardDeliveryCost(-1, 240)).toBeNull();
    expect(dashboardDeliveryCost(Infinity, 240)).toBeNull();
    expect(dashboardDeliveryCost(120, 0)).toEqual({ amount: 120, share: null });
    expect(dashboardDeliveryCost(120, -5)).toEqual({ amount: 120, share: null });
  });
});
