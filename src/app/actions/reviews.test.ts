import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); });
const m = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), ready: vi.fn(), rate: vi.fn(), purchase: vi.fn(), find: vi.fn(), create: vi.fn(), consent: vi.fn(), revoke: vi.fn(), remove: vi.fn(), update: vi.fn(), audit: vi.fn(), unique: vi.fn(), tx: vi.fn(), photos: vi.fn(), store: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: m.user, requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: m.purchase }, review: { findFirst: m.find }, $transaction: m.tx } }));
vi.mock("@/lib/privacy", () => ({ operatorReady: m.ready, consentDocument: async () => ({ operator: { name: "QA" } }), privacySubject: () => "hmac-not-email" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("@/lib/review-images", () => ({ reviewPhotoFiles: m.photos, storeReviewPhotos: m.store, removeReviewPhotos: m.cleanup }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { createReviewAction, deleteOwnReviewAction, moderateReviewAction } from "./reviews";
function form() { const data = new FormData(); for (const [key, value] of Object.entries({ productId: "product", author: "Покупатель", rating: "1", text: "Товар не понравился, неудобный", consent: "on", userId: "victim", orderId: "forged" })) data.set(key, value); return data; }
describe("review actions server-side authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.user.mockResolvedValue({ id: "buyer" }); m.permission.mockResolvedValue({ id: "staff" }); m.ready.mockResolvedValue(true); m.rate.mockReturnValue({ allowed: true }); m.purchase.mockResolvedValue({ id: "real-order" }); m.find.mockResolvedValue(null); m.consent.mockResolvedValue({ id: "consent" }); m.store.mockResolvedValue([{ fileName: "photo.webp", width: 10, height: 10, sortOrder: 0 }]);
    m.tx.mockImplementation(fn => fn({ $executeRaw: vi.fn(), reviewAiJob: { findUnique: vi.fn(), updateMany: vi.fn() }, order: { findFirst: m.purchase }, review: { findFirst: m.find, findUnique: m.unique, create: m.create, delete: m.remove, update: m.update }, privacyConsent: { create: m.consent, update: m.revoke }, auditLog: { create: m.audit } }));
  });
  it("denies anonymous users before reading purchases or storing files", async () => { m.user.mockRejectedValue(new Error("login")); await expect(createReviewAction(form())).rejects.toThrow("login"); expect(m.purchase).not.toHaveBeenCalled(); expect(m.store).not.toHaveBeenCalled(); });
  it("does not trust submitted user/order IDs and accepts a negative rating", async () => { await expect(createReviewAction(form())).rejects.toThrow("sent=1"); expect(m.purchase.mock.calls[0][0].where).toMatchObject({ userId: "buyer", status: "DELIVERED", items: { some: { productId: "product" } } }); expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: "buyer", productId: "product", rating: 1, verifiedPurchase: true, buyerKey: "buyer:product", consentId: "consent" }); expect(m.create.mock.calls[0][0].data).not.toHaveProperty("orderId"); expect(m.create.mock.calls[0][0].data).not.toHaveProperty("approved"); });
  it("blocks nonbuyers and duplicates before storing photos", async () => { m.purchase.mockResolvedValue(null); await expect(createReviewAction(form())).rejects.toThrow("error=purchase"); expect(m.store).not.toHaveBeenCalled(); m.purchase.mockResolvedValue({ id: "order" }); m.find.mockResolvedValue({ id: "existing" }); await expect(createReviewAction(form())).rejects.toThrow("error=duplicate"); expect(m.store).not.toHaveBeenCalled(); });
  it("keeps AI consent separate and queues only an explicitly opted-in review", async () => {
    vi.stubEnv("REVIEW_AI_TRANSFER_LEGAL_APPROVED", "true");
    await expect(createReviewAction(form())).rejects.toThrow("sent=1");
    expect(m.create.mock.calls[0][0].data.aiJob.create).toMatchObject({ status: "MANUAL", reason: "consent" });
    expect(m.create.mock.calls[0][0].data.aiJob.create).not.toHaveProperty("consentId");
    expect(m.consent).toHaveBeenCalledTimes(1);
    m.consent.mockClear(); m.create.mockClear();
    m.consent.mockResolvedValueOnce({ id: "publication" }).mockResolvedValueOnce({ id: "ai-consent" });
    const data = form(); data.set("aiConsent", "on"); data.set("approved", "true"); data.set("status", "PUBLISHED");
    await expect(createReviewAction(data)).rejects.toThrow("sent=1");
    expect(m.consent).toHaveBeenCalledTimes(2);
    expect(m.consent.mock.calls[1][0].data).toMatchObject({ userId: "buyer", purpose: "review-ai" });
    expect(m.create.mock.calls[0][0].data).toMatchObject({ status: "PENDING", consentId: "publication", aiJob: { create: { status: "PENDING", reason: "queued", consentId: "ai-consent" } } });
    expect(m.create.mock.calls[0][0].data).not.toHaveProperty("approved");
  });
  it("ignores a forged AI opt-in while the server transfer gate is closed", async () => {
    vi.stubEnv("REVIEW_AI_TRANSFER_LEGAL_APPROVED", "false");
    const data = form(); data.set("aiConsent", "on");
    await expect(createReviewAction(data)).rejects.toThrow("sent=1");
    expect(m.consent).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].data.aiJob.create.status).toBe("MANUAL");
  });
  it("checks purchase again inside the write transaction and cleans uploaded files on failure", async () => { m.purchase.mockResolvedValueOnce({ id: "order" }).mockResolvedValue(null); await expect(createReviewAction(form())).rejects.toThrow("error=purchase"); expect(m.cleanup).toHaveBeenCalledWith(["photo.webp"]); expect(m.create).not.toHaveBeenCalled(); });
  it("rejects missing publication consent and malformed images", async () => { const data = form(); data.delete("consent"); await expect(createReviewAction(data)).rejects.toThrow("error=invalid"); expect(m.store).not.toHaveBeenCalled(); m.photos.mockImplementation(() => { throw new Error("images"); }); await expect(createReviewAction(form())).rejects.toThrow("error=images"); expect(m.create).not.toHaveBeenCalled(); });
  it("honors privacy setup and rate limits", async () => { m.ready.mockResolvedValue(false); await expect(createReviewAction(form())).rejects.toThrow("error=privacy"); m.ready.mockResolvedValue(true); m.rate.mockReturnValue({ allowed: false }); await expect(createReviewAction(form())).rejects.toThrow("error=rate"); expect(m.store).not.toHaveBeenCalled(); });
  it("requires deletion confirmation and exact ownership", async () => { const data = new FormData(); data.set("reviewId", "victim-review"); await expect(deleteOwnReviewAction(data)).rejects.toThrow("confirmation"); expect(m.tx).not.toHaveBeenCalled(); data.set("confirmation", "delete-review"); await expect(deleteOwnReviewAction(data)).rejects.toThrow("error=missing"); expect(m.find).toHaveBeenCalledWith({ where: { id: "victim-review", userId: "buyer" }, include: { images: true } }); expect(m.remove).not.toHaveBeenCalled(); });
  it("deletes photos and revokes the publication permission atomically with review deletion", async () => { m.find.mockResolvedValue({ id: "own", consentId: "consent", images: [{ fileName: "photo.webp" }] }); const data = new FormData(); data.set("reviewId", "own"); data.set("confirmation", "delete-review"); await expect(deleteOwnReviewAction(data)).rejects.toThrow("deleted=1"); expect(m.remove).toHaveBeenCalledWith({ where: { id: "own" } }); expect(m.revoke.mock.calls[0][0].where).toEqual({ id: "consent" }); expect(m.cleanup).toHaveBeenCalledWith(["photo.webp"]); });
  it("does not allow a buyer to approve their own review", async () => { m.permission.mockRejectedValue(new Error("forbidden")); await expect(moderateReviewAction(form())).rejects.toThrow("forbidden"); expect(m.permission).toHaveBeenCalledWith("content.write"); expect(m.update).not.toHaveBeenCalled(); });
  it("does not republish withdrawn consent, even for administrators", async () => { m.unique.mockResolvedValue({ id: "row", verifiedPurchase: true, consent: { revokedAt: new Date() } }); const data = new FormData(); data.set("reviewId", "row"); data.set("decision", "PUBLISHED"); await expect(moderateReviewAction(data)).rejects.toThrow("error=consent"); expect(m.update).not.toHaveBeenCalled(); });
  it("publishes without altering text/rating, and records a content-free audit", async () => { m.unique.mockResolvedValue({ id: "row", status: "PENDING", verifiedPurchase: true, consent: { revokedAt: null } }); const data = new FormData(); data.set("reviewId", "row"); data.set("decision", "PUBLISHED"); await expect(moderateReviewAction(data)).rejects.toThrow("saved=1"); expect(m.update).toHaveBeenCalledWith({ where: { id: "row" }, data: { status: "PUBLISHED", approved: true } }); expect(m.audit.mock.calls[0][0].data.after).toEqual({ status: "PUBLISHED" }); });
});
