import { describe, expect, it } from "vitest";
import { groupCartItems } from "./cart-groups";

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

