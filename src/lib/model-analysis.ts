export type ModelAnalysis = {
  format: "stl-binary" | "stl-ascii" | "obj" | "manual";
  triangleCount: number | null;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  volumeCm3: number | null;
  watertight: boolean | null;
  note?: string;
};

type Vertex = [number, number, number];

export function analyzeModel(buffer: Buffer, extension: string): ModelAnalysis {
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (ext === "stl") return analyzeStl(buffer);
  if (ext === "obj") return analyzeObj(buffer.toString("utf8"));
  return {
    format: "manual",
    triangleCount: null,
    widthMm: null,
    heightMm: null,
    depthMm: null,
    volumeCm3: null,
    watertight: null,
    note: `${ext.toUpperCase()} принят и требует проверки оператором`,
  };
}

function analyzeStl(buffer: Buffer): ModelAnalysis {
  if (buffer.length >= 84) {
    const triangleCount = buffer.readUInt32LE(80);
    if (84 + triangleCount * 50 === buffer.length) return analyzeBinaryStl(buffer, triangleCount);
  }
  return analyzeAsciiStl(buffer.toString("utf8"));
}

function analyzeBinaryStl(buffer: Buffer, triangleCount: number): ModelAnalysis {
  const vertices: Vertex[] = [];
  const edges = new Map<string, number>();
  let signedVolume = 0;
  for (let i = 0; i < triangleCount; i += 1) {
    const offset = 84 + i * 50 + 12;
    const triangle: Vertex[] = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const base = offset + vertex * 12;
      triangle.push([buffer.readFloatLE(base), buffer.readFloatLE(base + 4), buffer.readFloatLE(base + 8)]);
    }
    vertices.push(...triangle);
    signedVolume += triangleVolume(triangle[0], triangle[1], triangle[2]);
    countTriangleEdges(edges, triangle);
  }
  return resultFromMesh("stl-binary", vertices, triangleCount, signedVolume, edges);
}

function analyzeAsciiStl(text: string): ModelAnalysis {
  const values = [...text.matchAll(/vertex\s+(-?[\d.e+]+)\s+(-?[\d.e+]+)\s+(-?[\d.e+]+)/gi)];
  const vertices = values.map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as Vertex);
  const edges = new Map<string, number>();
  let signedVolume = 0;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const triangle = [vertices[i], vertices[i + 1], vertices[i + 2]] as Vertex[];
    signedVolume += triangleVolume(triangle[0], triangle[1], triangle[2]);
    countTriangleEdges(edges, triangle);
  }
  return resultFromMesh("stl-ascii", vertices, Math.floor(vertices.length / 3), signedVolume, edges);
}

function analyzeObj(text: string): ModelAnalysis {
  const vertices: Vertex[] = [];
  const faces: number[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      vertices.push([Number(x), Number(y), Number(z)]);
    } else if (line.startsWith("f ")) {
      faces.push(line.slice(2).trim().split(/\s+/).map((part) => Number(part.split("/")[0]) - 1));
    }
  }
  const edges = new Map<string, number>();
  let signedVolume = 0;
  let triangleCount = 0;
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i += 1) {
      const triangle = [vertices[face[0]], vertices[face[i]], vertices[face[i + 1]]] as Vertex[];
      if (triangle.some((vertex) => !vertex)) continue;
      signedVolume += triangleVolume(triangle[0], triangle[1], triangle[2]);
      countTriangleEdges(edges, triangle);
      triangleCount += 1;
    }
  }
  return resultFromMesh("obj", vertices, triangleCount, signedVolume, edges);
}

function resultFromMesh(
  format: ModelAnalysis["format"],
  vertices: Vertex[],
  triangleCount: number,
  signedVolume: number,
  edges: Map<string, number>,
): ModelAnalysis {
  if (!vertices.length) {
    return { format, triangleCount: 0, widthMm: null, heightMm: null, depthMm: null, volumeCm3: null, watertight: false, note: "В файле не найдена сетка" };
  }
  const xs = vertices.map((vertex) => vertex[0]);
  const ys = vertices.map((vertex) => vertex[1]);
  const zs = vertices.map((vertex) => vertex[2]);
  const watertight = edges.size > 0 && [...edges.values()].every((count) => count === 2);
  return {
    format,
    triangleCount,
    widthMm: round(Math.max(...xs) - Math.min(...xs), 3),
    heightMm: round(Math.max(...ys) - Math.min(...ys), 3),
    depthMm: round(Math.max(...zs) - Math.min(...zs), 3),
    volumeCm3: round(Math.abs(signedVolume) / 1000, 4),
    watertight,
    note: watertight ? undefined : "Сетка может быть незамкнутой; финальную цену подтвердит оператор",
  };
}

function triangleVolume(a: Vertex, b: Vertex, c: Vertex) {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  ) / 6;
}

function countTriangleEdges(edges: Map<string, number>, triangle: Vertex[]) {
  for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
    const left = vertexKey(a);
    const right = vertexKey(b);
    const key = left < right ? `${left}|${right}` : `${right}|${left}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
}

function vertexKey(vertex: Vertex) {
  return vertex.map((value) => value.toFixed(5)).join(",");
}

function round(value: number, decimals: number) {
  const power = 10 ** decimals;
  return Math.round(value * power) / power;
}
