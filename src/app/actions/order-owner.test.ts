import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), link: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/order-owner", () => ({ linkOrderOwner: m.link }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { linkOrderOwnerAction } from "./order-owner";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ orderId: "order-1", orderNumber: "3DP-TEST", targetUserId: "buyer-1", expectedOwnerId: "", confirmation: "3DP-TEST", attested: "on" })) data.set(key, value);
  return data;
}
beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "admin-1", roles: ["superadmin"], permissions: new Set() }); m.link.mockResolvedValue("linked"); });
describe("administrative order ownership", () => {
  it("requires the explicit number and attestation before assigning", async () => {
    const data = form(); data.delete("attested");
    await expect(linkOrderOwnerAction(data)).rejects.toThrow("error=confirmation");
    data.set("attested", "on"); data.set("confirmation", "3DP-OTHER");
    await expect(linkOrderOwnerAction(data)).rejects.toThrow("error=confirmation");
    expect(m.link).not.toHaveBeenCalled();
  });
  it("requires both user-management and order-management permissions", async () => {
    m.permission.mockResolvedValue({ id: "staff", roles: ["sales"], permissions: new Set(["users.write"]) });
    await expect(linkOrderOwnerAction(form())).rejects.toThrow("error=forbidden");
    expect(m.link).not.toHaveBeenCalled();
    expect(m.permission).toHaveBeenCalledWith("users.write");
  });
  it("links only the reviewed target and refreshes the buyer's account", async () => {
    await expect(linkOrderOwnerAction(form())).rejects.toThrow("owner=linked");
    expect(m.link).toHaveBeenCalledWith(expect.anything(), { actorId: "admin-1", orderId: "order-1", orderNumber: "3DP-TEST", targetUserId: "buyer-1", expectedOwnerId: null });
    expect(m.revalidate).toHaveBeenCalledWith("/account", "layout");
  });
});
