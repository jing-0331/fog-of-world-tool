import { describe, expect, it } from "vitest";

import {
  createProcessingReport,
  processingReportCounts,
  reportHasPartialResults,
} from "@/lib/timeline/report";

describe("processing report", () => {
  it("aggregates every report category", () => {
    const report = createProcessingReport({
      automaticSuccess: [{ segmentId: "a", message: "ok" }],
      userCorrectedSuccess: [{ segmentId: "b", message: "fixed" }],
      userExcluded: [{ segmentId: "c", message: "excluded" }],
      skippedFlights: [{ segmentId: "d", message: "flight" }],
      unresolved: [{ segmentId: "e", message: "unresolved" }],
      invalidData: [{ segmentId: "f", message: "invalid" }],
      providerAttempts: [
        {
          segmentId: "e",
          source: "openrouteservice",
          status: "failed",
          message: "failed",
          retryable: false,
        },
      ],
    });

    expect(processingReportCounts(report)).toEqual({
      automaticSuccess: 1,
      userCorrectedSuccess: 1,
      userExcluded: 1,
      skippedFlights: 1,
      unresolved: 1,
      invalidData: 1,
      providerAttempts: 1,
    });
    expect(reportHasPartialResults(report)).toBe(true);
  });

  it("creates isolated empty arrays by default", () => {
    const first = createProcessingReport();
    const second = createProcessingReport();
    first.unresolved.push({ segmentId: "x", message: "x" });

    expect(second.unresolved).toEqual([]);
    expect(reportHasPartialResults(second)).toBe(false);
  });
});
