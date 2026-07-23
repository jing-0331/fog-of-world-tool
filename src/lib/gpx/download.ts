export type GpxExportKind = "flight" | "timeline";

export function gpxFilename(kind: GpxExportKind, date = new Date()): string {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const prefix = kind === "flight" ? "FlightRoute" : "TimelineRoute";
  return `${prefix}${year}${month}${day}.gpx`;
}

export function createGpxDownload(
  xml: string,
  kind: GpxExportKind,
  date = new Date(),
): { url: string; filename: string; size: number } {
  const blob = new Blob([xml], { type: "application/gpx+xml;charset=utf-8" });
  return {
    url: URL.createObjectURL(blob),
    filename: gpxFilename(kind, date),
    size: blob.size,
  };
}
