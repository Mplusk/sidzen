type ModelFileRecord = {
  id: string;
  originalName: string;
  extension: string;
  sizeBytes: bigint;
  widthMm: unknown;
  heightMm: unknown;
  depthMm: unknown;
  volumeCm3: unknown;
  watertight: boolean | null;
  status: string;
  analysisNote: string | null;
};

export function modelFileResponse(file: ModelFileRecord) {
  return {
    id: file.id,
    originalName: file.originalName,
    extension: file.extension,
    sizeBytes: Number(file.sizeBytes),
    widthMm: numberOrNull(file.widthMm),
    heightMm: numberOrNull(file.heightMm),
    depthMm: numberOrNull(file.depthMm),
    volumeCm3: numberOrNull(file.volumeCm3),
    watertight: file.watertight,
    status: file.status,
    analysisNote: file.analysisNote,
  };
}

function numberOrNull(value: unknown) {
  return value == null ? null : Number(value);
}
