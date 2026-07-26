import { z } from "zod";

import {
  GENERAL_ROUTE_MODES,
  PUBLIC_TRANSIT_MODES,
} from "@/lib/domain/types";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const repairableModeSchema = z.enum([
  ...GENERAL_ROUTE_MODES,
  ...PUBLIC_TRANSIT_MODES,
]);

export const repairRequestSchema = z.object({
  id: z.string().min(1),
  mode: repairableModeSchema,
  startPoint: pointSchema,
  endPoint: pointSchema,
  startTime: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value))),
  endTime: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value))),
});
