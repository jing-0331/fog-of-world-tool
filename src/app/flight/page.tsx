"use client";

import { useEffect, useRef, useState } from "react";

import { ConfirmedFlightList } from "@/components/flight/confirmed-flight-list";
import { FlightExportDialog } from "@/components/flight/flight-export-dialog";
import {
  FlightRouteSourceList,
  type ResolvedFlightRoute,
} from "@/components/flight/flight-route-source-list";
import { FlightSearchForm } from "@/components/flight/flight-search-form";
import { DownloadCard } from "@/components/download-card";
import { ProgressPanel } from "@/components/progress-panel";
import type {
  ConfirmedFlight,
  RouteSegment,
} from "@/lib/domain/types";
import { useFlightSession } from "@/lib/flight/use-flight-session";
import { buildGpx } from "@/lib/gpx/build-gpx";
import { createGpxDownload } from "@/lib/gpx/download";
import { validateGpx } from "@/lib/gpx/validate-gpx";

interface ExportFailure {
  flightNumber: string;
  message: string;
}

interface ResolveFlightsOptions {
  fetchFn?: typeof fetch;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function resolveFlightsForExport(
  flights: ConfirmedFlight[],
  {
    fetchFn = fetch,
    onProgress = () => undefined,
    signal,
  }: ResolveFlightsOptions = {},
): Promise<{
  routes: ResolvedFlightRoute[];
  segments: RouteSegment[];
  failures: ExportFailure[];
  canceled: boolean;
}> {
  const routes: ResolvedFlightRoute[] = [];
  const segments: RouteSegment[] = [];
  const failures: ExportFailure[] = [];

  for (let index = 0; index < flights.length; index += 1) {
    if (signal?.aborted) {
      return { routes: [], segments: [], failures: [], canceled: true };
    }
    const flight = flights[index];
    onProgress(`正在搜索第 ${index + 1} 個航班的路線`);
    try {
      const response = await fetchFn("/api/flights/resolve-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flight }),
        signal,
      });
      const body = (await response.json()) as {
        data?: { segment: RouteSegment };
        error?: { message: string };
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "找不到可用路線。");
      }
      onProgress(`正在將第 ${index + 1} 個航班轉換為 GPX 檔`);
      routes.push({ flight, segment: body.data.segment });
      segments.push(body.data.segment);
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return { routes: [], segments: [], failures: [], canceled: true };
      }
      failures.push({
        flightNumber: flight.flightNumber,
        message: error instanceof Error ? error.message : "路線處理失敗。",
      });
    }
  }

  return { routes, segments, failures, canceled: false };
}

export default function FlightPage() {
  const session = useFlightSession();
  const [showForm, setShowForm] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [routes, setRoutes] = useState<ResolvedFlightRoute[]>([]);
  const [failures, setFailures] = useState<ExportFailure[]>([]);
  const [download, setDownload] = useState<{
    url: string;
    filename: string;
    size: number;
  } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  if (!session.loaded) {
    return (
      <main className="workflow-shell">
        <p>載入航班清單…</p>
      </main>
    );
  }

  function addConfirmedFlight(flight: ConfirmedFlight) {
    session.addFlight(flight);
    setShowForm(false);
  }

  async function exportFlights() {
    setDialogOpen(false);
    setDownload(null);
    setRoutes([]);
    setFailures([]);
    setProcessing(true);
    setProgress("正在準備航班路線");
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const result = await resolveFlightsForExport(session.flights, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (result.canceled) {
        return;
      }
      setRoutes(result.routes);
      setFailures(result.failures);

      if (result.segments.length === 0) {
        return;
      }
      setProgress("正在建立與驗證 GPX 檔");
      const xml = buildGpx({
        name: "航班路線",
        segments: result.segments,
        report: { unresolvedCount: result.failures.length },
      });
      const validation = validateGpx(xml);
      if (!validation.valid) {
        setFailures((current) => [
          ...current,
          { flightNumber: "GPX", message: validation.errors.join(" ") },
        ]);
        return;
      }
      setDownload(createGpxDownload(xml, "flight"));
    } finally {
      controllerRef.current = null;
      setProgress(null);
      setProcessing(false);
    }
  }

  return (
    <main className="workflow-shell">
      <header className="workflow-heading">
        <p className="eyebrow">航班 GPX</p>
        <h1>加入你搭乘的航班</h1>
        <p>逐一確認後再匯出；單一航班失敗不會阻擋後續航班。</p>
      </header>

      {session.flights.length === 0 || showForm ? (
        <FlightSearchForm onConfirm={addConfirmedFlight} />
      ) : null}

      {session.flights.length > 0 ? (
        <ConfirmedFlightList
          flights={session.flights}
          onAdd={() => setShowForm(true)}
          onEdit={(flight) => {
            session.removeFlight(flight.id);
            setShowForm(true);
          }}
          onDelete={session.removeFlight}
        />
      ) : null}

      {session.flights.length > 0 && !processing ? (
          <button
            className="primary-button export-button"
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            匯出 GPX
          </button>
      ) : null}

      <FlightExportDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onConfirm={exportFlights}
      />

      {processing && progress ? (
        <div className="workflow-action-stack">
          <ProgressPanel title="處理航班" message={progress} />
          <button
            className="danger-button"
            type="button"
            onClick={() => controllerRef.current?.abort()}
          >
            取消處理
          </button>
        </div>
      ) : null}

      {routes.length > 0 ? (
        <FlightRouteSourceList routes={routes} />
      ) : null}

      {failures.length > 0 ? (
        <section className="workflow-panel" aria-labelledby="failed-title">
          <h2 id="failed-title">未匯出的航班</h2>
          <ul>
            {failures.map((failure, index) => (
              <li key={`${failure.flightNumber}-${index}`}>
                {failure.flightNumber}：{failure.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {download ? (
        <DownloadCard
          {...download}
          warning={
            failures.length > 0
              ? "部分航班未成功，已產生可下載的部分結果。"
              : undefined
          }
        />
      ) : null}
    </main>
  );
}
