import { describe, expect, it } from "vitest";
import { groupCartItems, maxCartGroupQuantity } from "./cart-groups";

describe("groupCartItems", () => {
  const updatedAt = new Date("2030-01-01T00:00:00.000Z");
  it("groups identical lines without altering source rows", () => {
    const input = [{ id: "a", groupKey: "same", quantity: 1, updatedAt, groupState: "a".repeat(64) }, { id: "b", groupKey: "same", quantity: 2, updatedAt, groupState: "a".repeat(64) }, { id: "c", groupKey: "other", quantity: 1, updatedAt, groupState: "a".repeat(64) }];
    const grouped = groupCartItems(input);
    expect(grouped.map(item => item.quantity)).toEqual([3, 1]);
    expect(grouped[0].members.map(item => item.id)).toEqual(["a", "b"]);
    expect(input[0].quantity).toBe(1);
  });
  it("keeps unknown configurations separate and never exceeds 999", () => {
    const lines = [{ id: "a", groupKey: null, quantity: 1, updatedAt, groupState: "a".repeat(64) }, { id: "b", groupKey: null, quantity: 2, updatedAt, groupState: "a".repeat(64) }, { id: "c", groupKey: "same", quantity: 999, updatedAt, groupState: "a".repeat(64) }, { id: "d", groupKey: "same", quantity: 1, updatedAt, groupState: "a".repeat(64) }];
    expect(groupCartItems(lines).map(item => item.quantity)).toEqual([1, 2, 999, 1]);
  });
});

it("limits each configuration by free stock after other groups of the same product", () => {
  const groups = [
    { id: "a", productId: "p", quantity: 1, options: { stock: 7 }, product: { madeToOrder: false } },
    { id: "b", productId: "p", quantity: 2, options: { stock: 7 }, product: { madeToOrder: false } },
    { id: "c", productId: "other", quantity: 4, options: { stock: 9 }, product: { madeToOrder: false } },
  ];
  expect(maxCartGroupQuantity(groups[0], groups)).toBe(5);
  expect(maxCartGroupQuantity(groups[1], groups)).toBe(6);
  expect(maxCartGroupQuantity({ ...groups[0], options: { stock: 1 } }, groups)).toBe(0);
  expect(maxCartGroupQuantity({ ...groups[0], product: { madeToOrder: true } }, groups)).toBe(999);
});
