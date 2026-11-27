import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), control: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/restore-control", () => ({ restoreControl: mocks.control }));
import { GET } from "./route";
import { POST } from "./restore/route";

const id = "95c1714e-9e57-4b1a-93b7-cfbbaf6c39a2";
const name = "sidzen-20261127T203510Z.tar.age";
const request = (origin: string, body: unknown) => new Request("http://localhost/api/admin/backups/restore/", {
  method: "POST", headers: { origin, host: "sidzen.shop", "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "fixture-admin", roles: ["superadmin"], adminConfirmationRequired: false });
  mocks.control.mockResolvedValue({ id, status: "queued" });
});

describe("backup recovery authorization", () => {
  it("rejects users without a verified superadmin session", async () => {
    mocks.user.mockResolvedValue({ roles: ["admin"], adminConfirmationRequired: false });
    expect((await GET()).status).toBe(403);
    mocks.user.mockResolvedValue({ roles: ["superadmin"], adminConfirmationRequired: true });
    expect((await POST(request("https://sidzen.shop", { id, name, confirmation: "RESTORE" }))).status).toBe(403);
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it("rejects foreign origins and paths that cannot be backup names", async () => {
    expect((await POST(request("https://elsewhere.example", { id, name, confirmation: "RESTORE" }))).status).toBe(403);
    expect((await POST(request("https://sidzen.shop", { id, name: "../../secret", confirmation: "RESTORE" }))).status).toBe(400);
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it("forwards only a confirmed backup and operation id to the host", async () => {
    expect((await POST(request("https://sidzen.shop", { id, name, confirmation: "RESTORE" }))).status).toBe(200);
    expect(mocks.control).toHaveBeenCalledWith({ action: "start", id, name });
  });
});
