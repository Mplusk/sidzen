import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn(), remove: vi.fn(), count: vi.fn() }));
vi.mock("node:fs/promises", () => ({ opendir: m.open, stat: m.stat, unlink: m.remove }));
vi.mock("@/lib/prisma", () => ({ prisma: { reviewImage: { count: m.count } } }));
import { pruneOrphanReviewPhotos } from "./review-image-maintenance";
const file = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp", now = 100000000;
describe("bounded review photo cleanup", () => {
  beforeEach(() => { vi.resetAllMocks(); m.open.mockResolvedValue({ async *[Symbol.asyncIterator]() { yield { name: file, isFile: () => true }; yield { name: "model.stl", isFile: () => true }; yield { name: "nested", isFile: () => false }; } }); m.stat.mockResolvedValue({ mtimeMs: 0 }); m.count.mockResolvedValue(0); m.remove.mockResolvedValue(undefined); });
  it("only removes old, unreferenced UUID WebPs in the review directory", async () => { await pruneOrphanReviewPhotos(now); expect(m.remove).toHaveBeenCalledOnce(); expect(m.remove.mock.calls[0][0]).toMatch(/private-uploads\/reviews\/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp$/); expect(m.stat).toHaveBeenCalledOnce(); });
  it("retains recent uploads and referenced files", async () => { m.stat.mockResolvedValue({ mtimeMs: now }); await pruneOrphanReviewPhotos(now); expect(m.count).not.toHaveBeenCalled(); m.stat.mockResolvedValue({ mtimeMs: 0 }); m.count.mockResolvedValue(1); await pruneOrphanReviewPhotos(now); expect(m.remove).not.toHaveBeenCalled(); });
  it("tolerates a missing review directory", async () => { m.open.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })); await expect(pruneOrphanReviewPhotos(now)).resolves.toBeUndefined(); expect(m.remove).not.toHaveBeenCalled(); });
});
