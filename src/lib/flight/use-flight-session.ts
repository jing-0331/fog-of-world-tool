"use client";

import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

import type { ConfirmedFlight } from "@/lib/domain/types";

const STORAGE_KEY = "fog-of-world:confirmed-flights";
const STORAGE_VERSION = 1;

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
const airportSchema = z.object({
  name: z.string(),
  city: z.string(),
  iata: z.string().optional(),
  icao: z.string().optional(),
  point: pointSchema,
});
const flightSchema = z.object({
  id: z.string(),
  flightNumber: z.string(),
  status: z.string(),
  canceled: z.boolean(),
  departureAirport: airportSchema,
  arrivalAirport: airportSchema,
  scheduledDeparture: z.string(),
  scheduledArrival: z.string(),
  actualDeparture: z.string().optional(),
  actualArrival: z.string().optional(),
  durationMinutes: z.number(),
  aircraftIcao24: z.string().optional(),
  filedRoute: z.string().optional(),
  confirmedAt: z.string(),
});
const storedSessionSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  flights: z.array(flightSchema),
});

interface FlightSessionSnapshot {
  flights: ConfirmedFlight[];
  loaded: boolean;
}

const serverSnapshot: FlightSessionSnapshot = { flights: [], loaded: false };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSnapshot: FlightSessionSnapshot = { flights: [], loaded: true };

function readSnapshot(): FlightSessionSnapshot {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedSnapshot;
  }

  cachedRaw = raw;
  if (raw === null) {
    cachedSnapshot = { flights: [], loaded: true };
    return cachedSnapshot;
  }
  try {
    const parsed = storedSessionSchema.parse(JSON.parse(raw));
    cachedSnapshot = { flights: parsed.flights, loaded: true };
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    cachedRaw = null;
    cachedSnapshot = { flights: [], loaded: true };
  }
  return cachedSnapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function store(flights: ConfirmedFlight[]): void {
  const raw = JSON.stringify({ version: STORAGE_VERSION, flights });
  sessionStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedSnapshot = { flights, loaded: true };
  listeners.forEach((listener) => listener());
}

export function useFlightSession() {
  const { flights, loaded } = useSyncExternalStore(
    subscribe,
    readSnapshot,
    () => serverSnapshot,
  );

  const addFlight = useCallback(
    (flight: ConfirmedFlight) => {
      store([...flights, flight]);
    },
    [flights],
  );

  const updateFlight = useCallback(
    (flight: ConfirmedFlight) => {
      store(
        flights.map((existing) =>
          existing.id === flight.id ? flight : existing,
        ),
      );
    },
    [flights],
  );

  const removeFlight = useCallback(
    (id: string) => {
      store(flights.filter((flight) => flight.id !== id));
    },
    [flights],
  );

  return { flights, loaded, addFlight, updateFlight, removeFlight };
}
