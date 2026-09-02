import { describe, expect, it } from "vitest";
import { modelFileResponse } from "./model-file-response";

describe("modelFileResponse", () => {
  it("does not expose storage, ownership, hash, or guest secrets", () => {
    const source = {
      id: "file-1",
      originalName: "part.stl",
      extension: "stl",
      sizeBytes: 2048n,
      widthMm: "42.5",
      heightMm: null,
      depthMm: 12,
      volumeCm3: "3.2",
      watertight: true,
      status: "ANALYZED",
      analysisNote: null,
      storedName: "private-random-name.stl",
      guestKey: "secret-owner-token",
      sha256: "internal-hash",
      ownerId: "user-1",
    };

    const response = modelFileResponse(source);
    expect(response).toMatchObject({ id: "file-1", sizeBytes: 2048, widthMm: 42.5, volumeCm3: 3.2 });
    expect(response).not.toHaveProperty("storedName");
    expect(response).not.toHaveProperty("guestKey");
    expect(response).not.toHaveProperty("sha256");
    expect(response).not.toHaveProperty("ownerId");
  });
});
