import { describe, expect, it } from "vitest";

import {
  GENERAL_ROUTE_MODES,
  PUBLIC_TRANSIT_MODES,
} from "@/lib/domain/types";
import {
  repairRequestSchema,
} from "@/lib/routing/repair-request-schema";

const baseRequest = {
  id: "gap-1",
  startPoint: { lat: 25, lon: 121.5 },
  endPoint: { lat: 25.1, lon: 121.6 },
  startTime: "2026-01-01T00:00:00Z",
  endTime: "2026-01-01T01:00:00Z",
};

describe("repairRequestSchema", () => {
  it.each([...GENERAL_ROUTE_MODES, ...PUBLIC_TRANSIT_MODES])(
    "accepts repairable mode %s",
    (mode) => {
      expect(
        repairRequestSchema.parse({ ...baseRequest, mode }).mode,
      ).toBe(mode);
    },
  );

  it.each(["flying", "unknown"])(
    "rejects non-repairable mode %s",
    (mode) => {
      expect(() =>
        repairRequestSchema.parse({ ...baseRequest, mode }),
      ).toThrow();
    },
  );
});
