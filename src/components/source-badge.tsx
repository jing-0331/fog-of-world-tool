import type { RouteKind, RouteSource } from "@/lib/domain/types";
import {
  routeKindLabel,
  routeSourceLabel,
} from "@/lib/domain/provenance";

interface SourceBadgeProps {
  kind: RouteKind;
  source: RouteSource;
  referenceDate?: string | null;
  approximate?: boolean;
}

export function SourceBadge({
  kind,
  source,
  referenceDate,
  approximate = false,
}: SourceBadgeProps) {
  const showReferenceDate =
    referenceDate &&
    kind !== "actual-track" &&
    kind !== "direct-line";

  return (
    <span
      className="source-badge"
      data-route-kind={kind}
      data-testid="source-badge"
    >
      <span className="badge-pill">{routeKindLabel(kind)}</span>
      <span className="badge-pill" data-tone="source">
        {routeSourceLabel(source)}
      </span>
      {showReferenceDate ? (
        <span className="badge-pill">參考日期 {referenceDate}</span>
      ) : null}
      {approximate ? (
        <span className="badge-pill" data-tone="approximate">
          近似路線
        </span>
      ) : null}
    </span>
  );
}
