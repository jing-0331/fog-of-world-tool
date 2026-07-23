import type { FlightCandidate } from "@/lib/domain/types";

interface FlightConfirmationCardProps {
  candidate: FlightCandidate;
  onConfirm: (candidate: FlightCandidate) => void;
}

function airportLabel(candidate: FlightCandidate, side: "departure" | "arrival") {
  const airport =
    side === "departure"
      ? candidate.departureAirport
      : candidate.arrivalAirport;
  const code = airport.iata ?? airport.icao ?? "無代碼";
  return `${airport.city} · ${airport.name}（${code}）`;
}

export function FlightConfirmationCard({
  candidate,
  onConfirm,
}: FlightConfirmationCardProps) {
  return (
    <article className="flight-card">
      <header>
        <strong>{candidate.flightNumber}</strong>
        {candidate.canceled ? <span className="status-error">已取消</span> : null}
      </header>
      <div className="flight-leg">
        <p>{airportLabel(candidate, "departure")}</p>
        <time dateTime={candidate.scheduledDeparture}>
          {candidate.scheduledDeparture}
        </time>
      </div>
      <span aria-hidden="true">→</span>
      <div className="flight-leg">
        <p>{airportLabel(candidate, "arrival")}</p>
        <time dateTime={candidate.scheduledArrival}>
          {candidate.scheduledArrival}
        </time>
      </div>
      <p>{candidate.durationMinutes} 分鐘</p>
      <button
        className="primary-button"
        type="button"
        onClick={() => onConfirm(candidate)}
      >
        是
      </button>
    </article>
  );
}
