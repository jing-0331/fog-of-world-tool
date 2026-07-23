import type { GeoPoint } from "@/lib/domain/types";

const COORDINATE_PATTERN =
  /^\s*(?:geo:)?(-?(?:\d+(?:\.\d+)?|\.\d+))°?\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))°?\s*$/;

export function parseCoordinate(value: unknown): GeoPoint | null {
  const candidate =
    typeof value === "string"
      ? value
      : isRecord(value) && typeof value.latLng === "string"
        ? value.latLng
        : null;

  if (candidate === null) {
    return null;
  }

  const match = COORDINATE_PATTERN.exec(candidate);
  if (!match) {
    return null;
  }

  const lat = Number(match[1]);
  const lon = Number(match[2]);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  return { lat, lon };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
