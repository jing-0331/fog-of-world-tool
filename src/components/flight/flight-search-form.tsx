"use client";

import { useState, type FormEvent } from "react";

import type {
  Airport,
  ConfirmedFlight,
  FlightCandidate,
} from "@/lib/domain/types";
import { FlightConfirmationCard } from "@/components/flight/flight-confirmation-card";

interface FlightSearchFormProps {
  onConfirm: (flight: ConfirmedFlight) => void;
  fetchFn?: typeof fetch;
}

interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

function confirmed(candidate: FlightCandidate): ConfirmedFlight {
  return { ...candidate, confirmedAt: new Date().toISOString() };
}

async function airportLookup(
  query: string,
  fetchFn: typeof fetch,
): Promise<Airport> {
  const response = await fetchFn("/api/airports/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as {
    data?: Airport[];
    error?: ApiError;
  };
  if (!response.ok || !body.data?.[0]) {
    throw new Error(body.error?.message ?? "找不到機場。");
  }
  return body.data[0];
}

function offsetTime(local: string, offset: string): string {
  if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)) {
    throw new Error("UTC 時差格式應為 +08:00。");
  }
  return `${local.length === 16 ? `${local}:00` : local}${offset}`;
}

export function FlightSearchForm({
  onConfirm,
  fetchFn = fetch,
}: FlightSearchFormProps) {
  const [flightNumber, setFlightNumber] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [candidates, setCandidates] = useState<FlightCandidate[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const response = await fetchFn("/api/flights/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flightNumber, departureDate }),
      });
      const body = (await response.json()) as {
        data?: FlightCandidate[];
        error?: ApiError;
      };
      if (!response.ok || !body.data) {
        if (body.error?.code === "no_data") {
          setManual(true);
          return;
        }
        throw new Error(body.error?.message ?? "航班搜尋失敗。");
      }
      setCandidates(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "航班搜尋失敗。");
    } finally {
      setLoading(false);
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const departureAirport = await airportLookup(
        String(form.get("departureAirport")),
        fetchFn,
      );
      const arrivalAirport = await airportLookup(
        String(form.get("arrivalAirport")),
        fetchFn,
      );
      const scheduledDeparture = offsetTime(
        String(form.get("departureTime")),
        String(form.get("departureOffset")),
      );
      const scheduledArrival = offsetTime(
        String(form.get("arrivalTime")),
        String(form.get("arrivalOffset")),
      );
      const durationMinutes = Math.round(
        (Date.parse(scheduledArrival) - Date.parse(scheduledDeparture)) / 60_000,
      );
      if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
        throw new Error("抵達時間必須晚於出發時間。");
      }
      onConfirm({
        id: `manual:${flightNumber.replaceAll(/\s+/g, "").toUpperCase()}:${scheduledDeparture}`,
        flightNumber: flightNumber.replaceAll(/\s+/g, "").toUpperCase(),
        status: "Manual",
        canceled: false,
        departureAirport,
        arrivalAirport,
        scheduledDeparture,
        scheduledArrival,
        durationMinutes,
        confirmedAt: new Date().toISOString(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "手動資料無法確認。");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setCandidates([]);
    setManual(false);
    setError(null);
  }

  if (manual) {
    return (
      <section className="workflow-panel">
        <h2>手動輸入航班資料</h2>
        <p>請確認機場代碼、機場當地時間與 UTC 時差。</p>
        <form className="form-grid" onSubmit={submitManual}>
          <label>
            出發機場代碼
            <input name="departureAirport" required />
          </label>
          <label>
            抵達機場代碼
            <input name="arrivalAirport" required />
          </label>
          <label>
            出發時間
            <input name="departureTime" type="datetime-local" required />
          </label>
          <label>
            出發 UTC 時差
            <input name="departureOffset" defaultValue="+00:00" required />
          </label>
          <label>
            抵達時間
            <input name="arrivalTime" type="datetime-local" required />
          </label>
          <label>
            抵達 UTC 時差
            <input name="arrivalOffset" defaultValue="+00:00" required />
          </label>
          <button className="primary-button" type="submit" disabled={loading}>
            確認手動資料
          </button>
          <button type="button" onClick={reset}>
            重新輸入
          </button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="workflow-panel">
      <form className="search-form" onSubmit={search}>
        <label>
          航班編號
          <input
            value={flightNumber}
            onChange={(event) => setFlightNumber(event.target.value)}
            placeholder="例如 BR 857"
            required
          />
        </label>
        <label>
          出發日期
          <input
            type="date"
            value={departureDate}
            onChange={(event) => setDepartureDate(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "搜尋中…" : "搜尋航班"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {candidates.length > 0 ? (
        <div className="candidate-list">
          <h2>你搭乘的是否是這個航班？</h2>
          {candidates.map((candidate) => (
            <FlightConfirmationCard
              key={candidate.id}
              candidate={candidate}
              onConfirm={(selected) => onConfirm(confirmed(selected))}
            />
          ))}
          <button type="button" onClick={reset}>
            重新輸入
          </button>
        </div>
      ) : null}
    </section>
  );
}
