import { SourceBadge } from "@/components/source-badge";
import type { ProcessTimelineResult } from "@/lib/timeline/process-timeline";
import { processingReportCounts } from "@/lib/timeline/report";

interface TimelineReportProps {
  result: ProcessTimelineResult;
}

export function TimelineReport({ result }: TimelineReportProps) {
  const counts = processingReportCounts(result.report);
  return (
    <section className="workflow-panel grid gap-4" aria-labelledby="report-title">
      <div>
        <h2 id="report-title" className="text-xl font-semibold">
          處理報告
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          自動成功 {counts.automaticSuccess}、使用者修正{" "}
          {counts.userCorrectedSuccess}、排除 {counts.userExcluded}、略過飛行{" "}
          {counts.skippedFlights}、未解決 {counts.unresolved}、無效資料{" "}
          {counts.invalidData}
        </p>
      </div>

      {result.segments.length > 0 ? (
        <div>
          <h3 className="font-semibold">已輸出的路線來源</h3>
          <div className="badge-row mt-2">
            {result.segments.map((segment) => (
              <SourceBadge
                key={segment.id}
                kind={segment.provenance.kind}
                source={segment.provenance.source}
                referenceDate={segment.provenance.referenceDate}
                approximate={segment.provenance.approximate}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="font-semibold text-rose-700">沒有可匯出的路線。</p>
      )}

      {result.report.unresolved.length > 0 ? (
        <div>
          <h3 className="font-semibold text-rose-800">所有來源皆失敗</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-rose-800">
            {result.report.unresolved.map((item) => (
              <li key={item.segmentId}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.report.invalidData.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-amber-800">
          {result.report.invalidData.map((item) => (
            <li key={item.segmentId}>{item.message}</li>
          ))}
        </ul>
      ) : null}
      {result.warning ? (
        <p
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900"
          role="status"
        >
          {result.warning}
        </p>
      ) : null}
    </section>
  );
}
