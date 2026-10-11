import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => { throw new Error("Retired export must not read a session"); });
vi.mock("@/lib/prisma", () => { throw new Error("Retired export must not read the database"); });
import { GET } from "./route";

it("returns an uncached empty 410 without accessing any buyer data", async () => {
  const response = GET();
  expect(response.status).toBe(410);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
});
