import type { TimelineParseErrorCode } from "@/lib/timeline/stream-parser";
import type { TimelineParseResult } from "@/lib/timeline/schema";

export type TimelineWorkerRequest = {
  type: "parse";
  file: File;
};

export type TimelineWorkerResponse =
  | {
      type: "progress";
      progress: number;
    }
  | {
      type: "complete";
      result: TimelineParseResult;
    }
  | {
      type: "error";
      code: TimelineParseErrorCode | "unknown";
      message: string;
    };
