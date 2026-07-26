export type RouteKind =
  | "recorded-timeline"
  | "actual-track"
  | "filed-plan"
  | "simulated-plan"
  | "direct-line"
  | "ground-route"
  | "transit-route";

export type RouteSource =
  | "google-timeline"
  | "opensky"
  | "aerodatabox"
  | "flight-plan-database"
  | "openrouteservice"
  | "tdx"
  | "transitous"
  | "local-calculation"
  | "user";

export const GENERAL_ROUTE_MODES = [
  "walking",
  "running",
  "cycling",
  "motorcycling",
  "driving",
] as const;

export const PUBLIC_TRANSIT_MODES = [
  "transit",
  "train",
  "rail",
  "taiwan-rail",
  "high-speed-rail",
  "long-distance-rail",
  "night-rail",
  "regional-rail",
  "suburban-rail",
  "subway",
  "bus",
  "coach",
  "tram",
  "ferry",
  "funicular",
  "aerial-lift",
  "other-transit",
] as const;

export const TRANSPORT_MODES = [
  ...GENERAL_ROUTE_MODES,
  ...PUBLIC_TRANSIT_MODES,
  "flying",
  "unknown",
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];
export type GeneralRouteMode =
  (typeof GENERAL_ROUTE_MODES)[number];
export type PublicTransitMode =
  (typeof PUBLIC_TRANSIT_MODES)[number];

export interface RouteProvenance {
  kind: RouteKind;
  source: RouteSource;
  referenceDate: string | null;
  approximate: boolean;
  explanation: string;
  originalMode?: TransportMode;
  correctedMode?: TransportMode;
  userOverride?: boolean;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  time?: string;
  elevationMeters?: number;
}

export interface RouteSegment {
  id: string;
  name: string;
  mode: TransportMode;
  points: GeoPoint[];
  provenance: RouteProvenance;
}

export interface Airport {
  name: string;
  city: string;
  iata?: string;
  icao?: string;
  point: GeoPoint;
}

export interface FlightCandidate {
  id: string;
  flightNumber: string;
  status: string;
  canceled: boolean;
  departureAirport: Airport;
  arrivalAirport: Airport;
  scheduledDeparture: string;
  scheduledArrival: string;
  actualDeparture?: string;
  actualArrival?: string;
  durationMinutes: number;
  aircraftIcao24?: string;
  filedRoute?: string;
}

export interface ConfirmedFlight extends FlightCandidate {
  confirmedAt: string;
}

export interface TimelineActivity {
  id: string;
  mode: TransportMode;
  startTime: string;
  endTime: string;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  points: GeoPoint[];
  probability?: number;
}

export type ProviderErrorCode =
  | "no_data"
  | "rate_limited"
  | "auth"
  | "quota"
  | "network"
  | "provider_unavailable";

export interface RepairAttempt {
  source: RouteSource;
  status: "success" | "failed" | "skipped";
  code?: ProviderErrorCode;
  message: string;
  retryable: boolean;
}

export interface ReportedRepairAttempt extends RepairAttempt {
  segmentId: string;
}

export interface ReportItem {
  segmentId: string;
  message: string;
  source?: RouteSource;
}

export interface ProcessingReport {
  automaticSuccess: ReportItem[];
  userCorrectedSuccess: ReportItem[];
  userExcluded: ReportItem[];
  skippedFlights: ReportItem[];
  unresolved: ReportItem[];
  invalidData: ReportItem[];
  providerAttempts: ReportedRepairAttempt[];
}
