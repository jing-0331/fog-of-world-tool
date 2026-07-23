import type { ConfirmedFlight, GeoPoint } from "@/lib/domain/types";

type FindNavaid = (ident: string) => Promise<GeoPoint>;

export async function resolveFiledPlan(
  flight: ConfirmedFlight,
  findNavaid: FindNavaid,
): Promise<GeoPoint[] | null> {
  const origin = flight.departureAirport.icao?.toUpperCase();
  const destination = flight.arrivalAirport.icao?.toUpperCase();
  if (!flight.filedRoute || !origin || !destination) {
    return null;
  }

  const tokens = flight.filedRoute
    .toUpperCase()
    .split(/\s+/)
    .filter((token) => /^[A-Z0-9]{2,7}$/.test(token) && token !== "DCT");
  if (
    tokens.length < 3 ||
    tokens[0] !== origin ||
    tokens.at(-1) !== destination
  ) {
    return null;
  }

  const intermediatePoints: GeoPoint[] = [];
  for (const ident of tokens.slice(1, -1)) {
    try {
      intermediatePoints.push(await findNavaid(ident));
    } catch {
      // Filed route strings can contain airway tokens that are not navaids.
    }
  }
  if (intermediatePoints.length === 0) {
    return null;
  }

  return [
    flight.departureAirport.point,
    ...intermediatePoints,
    flight.arrivalAirport.point,
  ];
}
