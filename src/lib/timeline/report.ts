import type { ProcessingReport } from "@/lib/domain/types";

export function createProcessingReport(
  initial: Partial<ProcessingReport> = {},
): ProcessingReport {
  return {
    automaticSuccess: [...(initial.automaticSuccess ?? [])],
    userCorrectedSuccess: [...(initial.userCorrectedSuccess ?? [])],
    userExcluded: [...(initial.userExcluded ?? [])],
    skippedFlights: [...(initial.skippedFlights ?? [])],
    unresolved: [...(initial.unresolved ?? [])],
    invalidData: [...(initial.invalidData ?? [])],
    providerAttempts: [...(initial.providerAttempts ?? [])],
  };
}

export function processingReportCounts(report: ProcessingReport) {
  return {
    automaticSuccess: report.automaticSuccess.length,
    userCorrectedSuccess: report.userCorrectedSuccess.length,
    userExcluded: report.userExcluded.length,
    skippedFlights: report.skippedFlights.length,
    unresolved: report.unresolved.length,
    invalidData: report.invalidData.length,
    providerAttempts: report.providerAttempts.length,
  };
}

export function reportHasPartialResults(report: ProcessingReport): boolean {
  return (
    report.userExcluded.length > 0 ||
    report.skippedFlights.length > 0 ||
    report.unresolved.length > 0 ||
    report.invalidData.length > 0
  );
}
