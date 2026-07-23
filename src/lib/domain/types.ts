export type RouteKind =
  | "recorded-timeline"
  | "actual-track"
  | "filed-plan"
  | "simulated-plan"
  | "great-circle"
  | "ground-route"
  | "transit-route";

export type RouteSource =
  | "google-timeline"
  | "opensky"
  | "aerodatabox"
  | "flight-plan-database"
  | "openrouteservice"
  | "transitous"
  | "local-calculation"
  | "user";

export type TransportMode =
  | "walking"
  | "running"
  | "cycling"
  | "motorcycling"
  | "driving"
  | "train"
  | "subway"
  | "bus"
  | "tram"
  | "ferry"
  | "flying"
  | "unknown";

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
