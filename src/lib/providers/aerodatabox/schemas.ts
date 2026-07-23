import { z } from "zod";

const dateTimeValueSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Invalid provider date-time",
);

export const aeroDataBoxDateTimeSchema = z.object({
  local: dateTimeValueSchema,
  utc: dateTimeValueSchema,
});

export const aeroDataBoxAirportSchema = z.object({
  name: z.string().min(1),
  municipalityName: z.string().nullish(),
  iata: z.string().nullish(),
  icao: z.string().nullish(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional(),
});

const movementSchema = z.object({
  airport: aeroDataBoxAirportSchema,
  scheduledTime: aeroDataBoxDateTimeSchema.optional(),
  revisedTime: aeroDataBoxDateTimeSchema.optional(),
  runwayTime: aeroDataBoxDateTimeSchema.optional(),
  quality: z.array(z.string()),
});

export const aeroDataBoxFlightSchema = z.object({
  number: z.string().min(1),
  status: z.string().min(1),
  codeshareStatus: z.string(),
  isCargo: z.boolean(),
  lastUpdatedUtc: dateTimeValueSchema,
  departure: movementSchema,
  arrival: movementSchema,
  aircraft: z
    .object({
      modeS: z.string().nullish(),
    })
    .optional(),
  flightPlan: z
    .object({
      route: z.string().min(1),
      lastUpdatedUtc: dateTimeValueSchema,
    })
    .optional(),
});

export const aeroDataBoxFlightListSchema = z.array(aeroDataBoxFlightSchema);

export const aeroDataBoxAirportSearchSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(aeroDataBoxAirportSchema),
});

export type AeroDataBoxFlight = z.infer<typeof aeroDataBoxFlightSchema>;
export type AeroDataBoxAirport = z.infer<typeof aeroDataBoxAirportSchema>;
