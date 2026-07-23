import type { GeoPoint } from "@/lib/domain/types";

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeRadians(radians: number): number {
  return ((radians + Math.PI) % (2 * Math.PI) + 2 * Math.PI) %
    (2 * Math.PI) -
    Math.PI;
}

export function distanceMeters(
  a: Pick<GeoPoint, "lat" | "lon">,
  b: Pick<GeoPoint, "lat" | "lon">,
): number {
  if (a.lat === b.lat && a.lon === b.lon) {
    return 0;
  }

  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);
  const latitudeDelta = latitudeB - latitudeA;
  const longitudeDelta = normalizeRadians(toRadians(b.lon - a.lon));

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  const centralAngle =
    2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_METERS * centralAngle;
}
