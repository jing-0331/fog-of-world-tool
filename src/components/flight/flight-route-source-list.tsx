import { useId } from "react";

import type {
  ConfirmedFlight,
  RouteSegment,
} from "@/lib/domain/types";
import {
  routeKindLabel,
  routeSourceLabel,
} from "@/lib/domain/provenance";

export interface ResolvedFlightRoute {
  flight: ConfirmedFlight;
  segment: RouteSegment;
}

interface FlightRouteSourceListProps {
  routes: ResolvedFlightRoute[];
}

export function FlightRouteSourceList({
  routes,
}: FlightRouteSourceListProps) {
  const titleId = useId();

  return (
    <section className="workflow-panel" aria-labelledby={titleId}>
      <h2 id={titleId}>路線來源</h2>
      <ul
        className="flight-route-source-list"
        aria-label="各航班路線來源"
      >
        {routes.map(({ flight, segment }) => {
          const { provenance } = segment;
          const showReferenceDate =
            provenance.referenceDate !== null &&
            provenance.kind !== "actual-track" &&
            provenance.kind !== "direct-line";

          return (
            <li
              className="flight-route-source-row"
              key={`${flight.id}:${segment.id}`}
            >
              <RouteField label="航班號" field="flight">
                <strong>{flight.flightNumber}</strong>
              </RouteField>
              <RouteField label="出發日期" field="date">
                <time dateTime={flight.scheduledDeparture}>
                  {flight.scheduledDeparture.slice(0, 10)}
                </time>
              </RouteField>
              <RouteField label="路徑來源" field="source">
                {routeSourceLabel(provenance.source)}
              </RouteField>
              <RouteField label="路徑類型" field="kind">
                {routeKindLabel(provenance.kind)}
              </RouteField>
              {showReferenceDate ? (
                <RouteField label="參考日期" field="reference">
                  {provenance.referenceDate}
                </RouteField>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RouteField({
  label,
  field,
  children,
}: {
  label: string;
  field: "flight" | "date" | "source" | "kind" | "reference";
  children: React.ReactNode;
}) {
  return (
    <span className="flight-route-source-field" data-field={field}>
      <span className="flight-route-source-label">{label}</span>
      <span className="flight-route-source-value">{children}</span>
    </span>
  );
}
