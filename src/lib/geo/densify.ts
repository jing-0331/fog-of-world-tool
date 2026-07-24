import type { GeoPoint } from "@/lib/domain/types";
import { distanceMeters } from "@/lib/geo/distance";

interface DensifyOptions {
  maxDistanceMeters: number;
  interpolation?: "spherical" | "linear";
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function interpolateNumber(
  start: number | undefined,
  end: number | undefined,
  fraction: number,
): number | undefined {
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return start + (end - start) * fraction;
}

function interpolateTime(
  start: string | undefined,
  end: string | undefined,
  fraction: number,
): string | undefined {
  if (start === undefined || end === undefined) {
    return undefined;
  }

  const startMilliseconds = Date.parse(start);
  const endMilliseconds = Date.parse(end);
  if (
    !Number.isFinite(startMilliseconds) ||
    !Number.isFinite(endMilliseconds)
  ) {
    return undefined;
  }

  return new Date(
    startMilliseconds + (endMilliseconds - startMilliseconds) * fraction,
  ).toISOString();
}

function sphericalInterpolate(
  start: GeoPoint,
  end: GeoPoint,
  fraction: number,
): GeoPoint {
  const startLatitude = toRadians(start.lat);
  const startLongitude = toRadians(start.lon);
  const endLatitude = toRadians(end.lat);
  const endLongitude = toRadians(end.lon);
  const startVector = [
    Math.cos(startLatitude) * Math.cos(startLongitude),
    Math.cos(startLatitude) * Math.sin(startLongitude),
    Math.sin(startLatitude),
  ];
  const endVector = [
    Math.cos(endLatitude) * Math.cos(endLongitude),
    Math.cos(endLatitude) * Math.sin(endLongitude),
    Math.sin(endLatitude),
  ];
  const dot = Math.max(
    -1,
    Math.min(
      1,
      startVector[0] * endVector[0] +
        startVector[1] * endVector[1] +
        startVector[2] * endVector[2],
    ),
  );
  const angle = Math.acos(dot);
  const sine = Math.sin(angle);

  let latitude: number;
  let longitude: number;

  if (Math.abs(sine) < 1e-12) {
    const longitudeDelta = normalizeLongitude(end.lon - start.lon);
    latitude = start.lat + (end.lat - start.lat) * fraction;
    longitude = normalizeLongitude(start.lon + longitudeDelta * fraction);
  } else {
    const startWeight = Math.sin((1 - fraction) * angle) / sine;
    const endWeight = Math.sin(fraction * angle) / sine;
    const x =
      startWeight * startVector[0] + endWeight * endVector[0];
    const y =
      startWeight * startVector[1] + endWeight * endVector[1];
    const z =
      startWeight * startVector[2] + endWeight * endVector[2];
    latitude = toDegrees(Math.atan2(z, Math.hypot(x, y)));
    longitude = normalizeLongitude(toDegrees(Math.atan2(y, x)));
  }

  const point: GeoPoint = { lat: latitude, lon: longitude };
  const time = interpolateTime(start.time, end.time, fraction);
  const elevationMeters = interpolateNumber(
    start.elevationMeters,
    end.elevationMeters,
    fraction,
  );

  if (time !== undefined) {
    point.time = time;
  }
  if (elevationMeters !== undefined) {
    point.elevationMeters = elevationMeters;
  }

  return point;
}

function linearInterpolate(
  start: GeoPoint,
  end: GeoPoint,
  fraction: number,
): GeoPoint {
  const longitudeDelta = normalizeLongitude(end.lon - start.lon);
  const point: GeoPoint = {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lon: normalizeLongitude(start.lon + longitudeDelta * fraction),
  };
  const time = interpolateTime(start.time, end.time, fraction);
  const elevationMeters = interpolateNumber(
    start.elevationMeters,
    end.elevationMeters,
    fraction,
  );
  if (time !== undefined) {
    point.time = time;
  }
  if (elevationMeters !== undefined) {
    point.elevationMeters = elevationMeters;
  }
  return point;
}

export function densifyPoints(
  points: GeoPoint[],
  {
    maxDistanceMeters,
    interpolation = "spherical",
  }: DensifyOptions,
): GeoPoint[] {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    throw new RangeError("maxDistanceMeters must be positive");
  }
  if (points.length < 2) {
    return points.map((point) => ({ ...point }));
  }

  const result: GeoPoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const intervalCount = Math.max(
      1,
      Math.ceil(distanceMeters(start, end) / maxDistanceMeters),
    );

    for (let interval = 1; interval <= intervalCount; interval += 1) {
      result.push(
        interval === intervalCount
          ? { ...end }
          : interpolation === "linear"
            ? linearInterpolate(start, end, interval / intervalCount)
            : sphericalInterpolate(start, end, interval / intervalCount),
      );
    }
  }

  return result;
}

export function interpolateRouteTimes(
  points: GeoPoint[],
  startIso: string,
  endIso: string,
): GeoPoint[] {
  const startMilliseconds = Date.parse(startIso);
  const endMilliseconds = Date.parse(endIso);
  if (
    !Number.isFinite(startMilliseconds) ||
    !Number.isFinite(endMilliseconds) ||
    endMilliseconds < startMilliseconds
  ) {
    throw new RangeError("Route time range is invalid");
  }
  if (points.length === 0) {
    return [];
  }

  const cumulativeDistances = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1] +
        distanceMeters(points[index - 1], points[index]),
    );
  }
  const totalDistance = cumulativeDistances.at(-1) ?? 0;

  return points.map((point, index) => {
    const fraction =
      totalDistance === 0
        ? points.length === 1
          ? 0
          : index / (points.length - 1)
        : cumulativeDistances[index] / totalDistance;
    return {
      ...point,
      time:
        point.time ??
        new Date(
          startMilliseconds +
            (endMilliseconds - startMilliseconds) * fraction,
        ).toISOString(),
    };
  });
}
