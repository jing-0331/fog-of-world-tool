import { XMLParser } from "fast-xml-parser";

import type { GeoPoint } from "@/lib/domain/types";
import { distanceMeters } from "@/lib/geo/distance";

export interface GpxValidationResult {
  valid: boolean;
  errors: string[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

interface ParsedTrackPoint {
  lat?: string | number;
  lon?: string | number;
  time?: string;
}

interface ParsedTrackSegment {
  trkpt?: ParsedTrackPoint | ParsedTrackPoint[];
}

interface ParsedTrack {
  trkseg?: ParsedTrackSegment | ParsedTrackSegment[] | string;
}

interface ParsedGpx {
  version?: string;
  xmlns?: string;
  trk?: ParsedTrack | ParsedTrack[];
}

function validatePoint(
  point: ParsedTrackPoint,
  label: string,
  errors: string[],
): GeoPoint | null {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors.push(`${label} has an invalid latitude.`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    errors.push(`${label} has an invalid longitude.`);
  }
  if (
    point.time !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      point.time,
    ) ||
      !Number.isFinite(Date.parse(point.time)))
  ) {
    errors.push(`${label} has an invalid UTC time.`);
  }

  return Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180
    ? { lat, lon }
    : null;
}

export function validateGpx(xml: string): GpxValidationResult {
  const errors: string[] = [];
  let root: ParsedGpx | undefined;

  try {
    const parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true,
    }).parse(xml) as { gpx?: ParsedGpx };
    root = parsed.gpx;
  } catch {
    return { valid: false, errors: ["GPX XML is malformed."] };
  }

  if (root === undefined) {
    return { valid: false, errors: ["GPX root element is missing."] };
  }
  if (root.version !== "1.1") {
    errors.push("GPX version must be 1.1.");
  }
  if (root.xmlns !== "http://www.topografix.com/GPX/1/1") {
    errors.push("GPX 1.1 namespace is missing.");
  }

  const segments: Array<ParsedTrackSegment | string> = [];
  asArray(root.trk).forEach((track) => {
    if (typeof track.trkseg === "string") {
      segments.push(track.trkseg);
      return;
    }
    segments.push(...asArray(track.trkseg));
  });
  if (segments.length === 0) {
    errors.push("GPX contains no track segments.");
  }

  segments.forEach((segment, segmentIndex) => {
    if (typeof segment === "string") {
      errors.push(`Track segment ${segmentIndex + 1} is empty.`);
      return;
    }
    const points = asArray(segment.trkpt);
    if (points.length === 0) {
      errors.push(`Track segment ${segmentIndex + 1} is empty.`);
      return;
    }

    const validPoints = points.map((point, pointIndex) =>
      validatePoint(
        point,
        `Track segment ${segmentIndex + 1}, point ${pointIndex + 1}`,
        errors,
      ),
    );
    for (let pointIndex = 1; pointIndex < validPoints.length; pointIndex += 1) {
      const previous = validPoints[pointIndex - 1];
      const current = validPoints[pointIndex];
      if (
        previous !== null &&
        current !== null &&
        distanceMeters(previous, current) > 2_000
      ) {
        errors.push(
          `Track segment ${segmentIndex + 1} has adjacent points over 2,000 meters.`,
        );
      }
    }
  });

  return { valid: errors.length === 0, errors };
}
