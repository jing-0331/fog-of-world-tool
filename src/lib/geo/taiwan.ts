import type { GeoPoint } from "@/lib/domain/types";

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const TAIWAN_REGIONS: BoundingBox[] = [
  { minLat: 21.8, maxLat: 25.4, minLon: 120, maxLon: 122 },
  { minLat: 23.1, maxLat: 23.9, minLon: 119.3, maxLon: 119.8 },
  { minLat: 24.35, maxLat: 24.55, minLon: 118.18, maxLon: 118.55 },
  { minLat: 25.9, maxLat: 26.4, minLon: 119.85, maxLon: 120.55 },
];

export function isTaiwanPoint(point: GeoPoint): boolean {
  return TAIWAN_REGIONS.some(
    (region) =>
      point.lat >= region.minLat &&
      point.lat <= region.maxLat &&
      point.lon >= region.minLon &&
      point.lon <= region.maxLon,
  );
}
