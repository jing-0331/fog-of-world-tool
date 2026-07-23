/// <reference lib="webworker" />

import {
  parseTimelineFile,
  TimelineParseError,
} from "@/lib/timeline/stream-parser";
import type {
  TimelineWorkerRequest,
  TimelineWorkerResponse,
} from "@/lib/timeline/worker-protocol";

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener(
  "message",
  async (event: MessageEvent<TimelineWorkerRequest>) => {
    if (event.data.type !== "parse") {
      return;
    }

    try {
      const result = await parseTimelineFile(event.data.file, (progress) => {
        post({ type: "progress", progress });
      });
      post({ type: "complete", result });
    } catch (error) {
      if (error instanceof TimelineParseError) {
        post({ type: "error", code: error.code, message: error.message });
        return;
      }
      post({
        type: "error",
        code: "unknown",
        message: "解析時間軸時發生未預期的錯誤。",
      });
    }
  },
);

function post(message: TimelineWorkerResponse) {
  worker.postMessage(message);
}

export {};
