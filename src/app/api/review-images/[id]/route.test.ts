import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ image: vi.fn(), visible: vi.fn(), user: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { reviewImage: { findUnique: m.image }, review: { count: m.visible } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("node:fs/promises", () => ({ readFile: m.read }));
vi.mock("@/lib/review-images", () => ({ reviewImagePath: (name: string) => `/private/${name}` }));
import { GET } from "./route";
const request = (id = "photo") => GET(new Request("https://3dprinta.shop/api/review-images/photo/"), { params: Promise.resolve({ id }) });
describe("protected review images", () => {
  beforeEach(() => { vi.resetAllMocks(); m.image.mockResolvedValue({ reviewId: "review", fileName: "random.webp", review: { userId: "owner" } }); m.visible.mockResolvedValue(0); m.user.mockResolvedValue(null); m.read.mockResolvedValue(Buffer.from("webp")); });
  it("never reads the filesystem for malformed or nonexistent IDs", async () => { expect((await request("../../private")).status).toBe(404); expect(m.image).not.toHaveBeenCalled(); m.image.mockResolvedValue(null); expect((await request()).status).toBe(404); expect(m.read).not.toHaveBeenCalled(); });
  it("hides pending images from anonymous and unrelated buyers", async () => { expect((await request()).status).toBe(404); m.user.mockResolvedValue({ id: "other", permissions: new Set(), roles: [] }); expect((await request()).status).toBe(404); expect(m.read).not.toHaveBeenCalled(); });
  it("allows the owner to preview without any public cache", async () => { m.user.mockResolvedValue({ id: "owner", permissions: new Set(), roles: [] }); const response = await request(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-type")).toBe("image/webp"); });
  it("only staff with content permission can preview pending photos", async () => { m.user.mockResolvedValue({ id: "staff", permissions: new Set(["content.write"]), roles: [] }); expect((await request()).status).toBe(200); });
  it("published consent-backed photos can be read without sign-in", async () => { m.visible.mockResolvedValue(1); expect((await request()).status).toBe(200); expect(m.user).not.toHaveBeenCalled(); expect(m.visible.mock.calls[0][0].where).toMatchObject({ id: "review", approved: true, OR: [{ verifiedPurchase: false }, { consent: { is: { revokedAt: null } } }] }); });
  it("does not expose file paths or error details", async () => { m.visible.mockResolvedValue(1); m.read.mockRejectedValue(new Error("secret filesystem path")); const response = await request(); expect(response.status).toBe(404); expect(await response.text()).toBe(""); });
});
