"use client";

import { useEffect, useRef, useState } from "react";

import type { TimelineParseResult } from "@/lib/timeline/schema";
import type {
  TimelineWorkerRequest,
  TimelineWorkerResponse,
} from "@/lib/timeline/worker-protocol";

const LARGE_FILE_BYTES = 200 * 1024 * 1024;

export interface TimelineWorkerLike {
  onmessage: ((event: MessageEvent<TimelineWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: TimelineWorkerRequest): void;
  terminate(): void;
}

interface TimelineUploaderProps {
  onParsed: (result: TimelineParseResult, file: File) => void;
  onReset?: () => void;
  workerFactory?: () => TimelineWorkerLike;
}

export function TimelineUploader({
  onParsed,
  onReset,
  workerFactory = createBrowserWorker,
}: TimelineUploaderProps) {
  const workerRef = useRef<TimelineWorkerLike | null>(null);
  const [status, setStatus] = useState<
    "idle" | "warning" | "parsing" | "complete" | "error"
  >("idle");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const terminateWorker = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  const parseFile = (file: File) => {
    terminateWorker();
    setError(null);
    setProgress(0);
    setStatus("parsing");
    const worker = workerFactory();
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "progress") {
        setProgress(message.progress);
        return;
      }
      if (message.type === "complete") {
        setProgress(1);
        setStatus("complete");
        terminateWorker();
        onParsed(message.result, file);
        return;
      }
      setStatus("error");
      setError(message.message);
      terminateWorker();
    };
    worker.onerror = () => {
      setStatus("error");
      setError("解析 Worker 發生錯誤，請重新選擇檔案。");
      terminateWorker();
    };
    worker.postMessage({ type: "parse", file });
  };

  const acceptFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      setStatus("error");
      setError("請選擇 .json 檔案。");
      return;
    }
    if (file.size > LARGE_FILE_BYTES) {
      setPendingFile(file);
      setStatus("warning");
      setError(null);
      return;
    }
    parseFile(file);
  };

  const reset = () => {
    terminateWorker();
    setStatus("idle");
    setPendingFile(null);
    setProgress(0);
    setError(null);
    onReset?.();
  };

  return (
    <section className="workflow-panel grid gap-4">
      <div
        className="grid min-h-48 place-items-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center"
        data-testid="timeline-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          acceptFile(event.dataTransfer.files[0]);
        }}
      >
        <div>
          <p className="font-semibold text-slate-900">
            拖放 Google Timeline JSON 到這裡
          </p>
          <p className="mt-2 text-sm text-slate-600">
            原始檔只會傳給此頁面的 Web Worker，不會 POST 到伺服器。
          </p>
          <label className="primary-button mt-4 inline-grid cursor-pointer place-items-center">
            選擇 JSON 檔案
            <input
              className="sr-only"
              type="file"
              accept=".json,application/json"
              aria-label="選擇 Google 時間軸 JSON"
              onChange={(event) => {
                acceptFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {status === "warning" && pendingFile ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p role="alert">
            這個檔案超過 200 MB，解析時間與瀏覽器記憶體用量可能較高。
          </p>
          <button
            type="button"
            className="primary-button mt-3"
            onClick={() => {
              const file = pendingFile;
              setPendingFile(null);
              parseFile(file);
            }}
          >
            仍要解析
          </button>
        </div>
      ) : null}

      {status === "parsing" ? (
        <div aria-live="polite">
          <p>正在本機解析… {Math.round(progress * 100)}%</p>
          <progress value={progress} max={1}>
            {Math.round(progress * 100)}%
          </progress>
        </div>
      ) : null}
      {status === "complete" ? (
        <p className="font-semibold text-emerald-700" role="status">
          上傳完成
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {status !== "idle" && status !== "parsing" ? (
        <button type="button" onClick={reset}>
          重新選擇檔案
        </button>
      ) : null}
    </section>
  );
}

function createBrowserWorker(): TimelineWorkerLike {
  return new Worker(
    new URL("../../workers/timeline-parser.worker.ts", import.meta.url),
    { type: "module" },
  );
}
