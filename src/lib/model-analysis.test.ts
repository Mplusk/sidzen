import { describe, expect, it } from "vitest";
import { analyzeModel } from "@/lib/model-analysis";

function tetrahedronStl() {
  const triangles = [
    [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
    [[0, 0, 0], [0, 0, 10], [10, 0, 0]],
    [[0, 0, 0], [0, 10, 0], [0, 0, 10]],
    [[10, 0, 0], [0, 0, 10], [0, 10, 0]],
  ];
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    let offset = 84 + index * 50 + 12;
    triangle.forEach((vertex) => {
      vertex.forEach((value) => { buffer.writeFloatLE(value, offset); offset += 4; });
    });
  });
  return buffer;
}

describe("analyzeModel", () => {
  it("reads binary STL bounds, volume and closed edges", () => {
    const analysis = analyzeModel(tetrahedronStl(), "stl");
    expect(analysis.format).toBe("stl-binary");
    expect(analysis.triangleCount).toBe(4);
    expect(analysis.widthMm).toBe(10);
    expect(analysis.volumeCm3).toBeCloseTo(1 / 6, 3);
    expect(analysis.watertight).toBe(true);
  });

  it("marks STEP for manual review", () => {
    const analysis = analyzeModel(Buffer.from("ISO-10303-21;"), "step");
    expect(analysis.format).toBe("manual");
    expect(analysis.volumeCm3).toBeNull();
  });
});
