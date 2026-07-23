import type { GeoPoint } from "@/lib/domain/types";

const ENCODING_TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

interface DecodePosition {
  index: number;
}

export function decodeFlexiblePolyline(encoded: string): GeoPoint[] | null {
  try {
    const position = { index: 0 };
    if (readUnsigned(encoded, position) !== 1) {
      return null;
    }

    const header = readUnsigned(encoded, position);
    const precision = header % 16;
    const thirdDimension = Math.floor(header / 16) % 8;
    const factor = 10 ** precision;
    const points: GeoPoint[] = [];
    let latitude = 0;
    let longitude = 0;

    while (position.index < encoded.length) {
      latitude += readSigned(encoded, position);
      longitude += readSigned(encoded, position);
      if (thirdDimension !== 0) {
        readSigned(encoded, position);
      }

      const point = {
        lat: latitude / factor,
        lon: longitude / factor,
      };
      if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
        return null;
      }
      points.push(point);
    }

    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

function readUnsigned(encoded: string, position: DecodePosition): number {
  let result = 0;
  let shift = 0;

  while (position.index < encoded.length) {
    const value = ENCODING_TABLE.indexOf(encoded[position.index]);
    position.index += 1;
    if (value < 0) {
      throw new Error("Invalid flexible-polyline character.");
    }

    result += (value % 32) * 2 ** shift;
    if (!Number.isSafeInteger(result)) {
      throw new Error("Flexible-polyline value exceeds safe integer range.");
    }
    if (value < 32) {
      return result;
    }
    shift += 5;
  }

  throw new Error("Truncated flexible polyline.");
}

function readSigned(encoded: string, position: DecodePosition): number {
  const value = readUnsigned(encoded, position);
  return value % 2 === 1 ? -(Math.floor(value / 2) + 1) : Math.floor(value / 2);
}
