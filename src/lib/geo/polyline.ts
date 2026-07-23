import polyline from "@mapbox/polyline";

import type { GeoPoint } from "@/lib/domain/types";

export function decodePolyline(
  encoded: string,
  precision: number,
): GeoPoint[] {
  return polyline.decode(encoded, precision).map(([lat, lon]) => ({ lat, lon }));
}
