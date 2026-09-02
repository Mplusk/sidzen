import { describe, expect, it } from "vitest";
import { normalizePageTitle } from "./seo";

describe("normalizePageTitle", () => {
  it("removes a stored brand suffix before the global title template", () => {
    expect(normalizePageTitle("Органайзер Axis | 3DPRINTA")).toBe("Органайзер Axis");
    expect(normalizePageTitle("Органайзеры — 3DPRINTA")).toBe("Органайзеры");
  });

  it("keeps ordinary titles intact", () => {
    expect(normalizePageTitle("3D-печать по модели")).toBe("3D-печать по модели");
  });
});
