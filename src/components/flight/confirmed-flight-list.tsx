import type { ConfirmedFlight } from "@/lib/domain/types";

interface ConfirmedFlightListProps {
  flights: ConfirmedFlight[];
  onAdd: () => void;
  onEdit: (flight: ConfirmedFlight) => void;
  onDelete: (id: string) => void;
}

function airportLabel(flight: ConfirmedFlight, side: "departure" | "arrival") {
  const airport =
    side === "departure"
      ? flight.departureAirport
      : flight.arrivalAirport;
  return `${airport.city} · ${airport.name}（${airport.iata ?? airport.icao ?? "無代碼"}）`;
}

export function ConfirmedFlightList({
  flights,
  onAdd,
  onEdit,
  onDelete,
}: ConfirmedFlightListProps) {
  return (
    <section className="workflow-panel" aria-labelledby="confirmed-title">
      <h2 id="confirmed-title">已確認航班</h2>
      <div className="confirmed-list">
        {flights.map((flight, index) => (
          <article className="flight-card" key={flight.id}>
            <header>
              <span>第 {index + 1} 段</span>
              <strong>{flight.flightNumber}</strong>
            </header>
            <div>
              <p>{airportLabel(flight, "departure")}</p>
              <time>{flight.scheduledDeparture}</time>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <p>{airportLabel(flight, "arrival")}</p>
              <time>{flight.scheduledArrival}</time>
            </div>
            <p>{flight.durationMinutes} 分鐘</p>
            <div className="button-row">
              <button
                className="secondary-button compact-button"
                type="button"
                aria-label={`編輯 ${flight.flightNumber}`}
                onClick={() => onEdit(flight)}
              >
                編輯
              </button>
              <button
                className="danger-button compact-button"
                type="button"
                aria-label={`刪除 ${flight.flightNumber}`}
                onClick={() => onDelete(flight.id)}
              >
                刪除
              </button>
            </div>
          </article>
        ))}
      </div>
      <button className="add-flight-button" type="button" onClick={onAdd}>
        ＋ 新增下一個航班
      </button>
    </section>
  );
}
