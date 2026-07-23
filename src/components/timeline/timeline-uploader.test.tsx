import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  TimelineUploader,
  type TimelineWorkerLike,
} from "@/components/timeline/timeline-uploader";
import type { TimelineParseResult } from "@/lib/timeline/schema";

const parsed: TimelineParseResult = {
  segments: [],
  dateRange: { min: "2026-01-01", max: "2026-01-03" },
  invalid: { coordinates: 0, missingTime: 0, segments: 0 },
};

describe("TimelineUploader", () => {
  it("validates .json files before creating a worker", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const workerFactory = vi.fn();
    render(
      <TimelineUploader workerFactory={workerFactory} onParsed={vi.fn()} />,
    );

    await user.upload(
      screen.getByLabelText("選擇 Google 時間軸 JSON"),
      new File(["x"], "timeline.txt", { type: "text/plain" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("請選擇 .json 檔案");
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("sends the File only to a worker and reports upload completion", async () => {
    const user = userEvent.setup();
    const worker = fakeWorker();
    const onParsed = vi.fn();
    render(
      <TimelineUploader
        workerFactory={() => worker}
        onParsed={onParsed}
      />,
    );
    const file = new File(["{}"], "timeline.json", {
      type: "application/json",
    });

    await user.upload(
      screen.getByLabelText("選擇 Google 時間軸 JSON"),
      file,
    );
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "parse", file });

    act(() => worker.emit({ type: "progress", progress: 0.5 }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0.5");
    act(() => worker.emit({ type: "complete", result: parsed }));

    expect(await screen.findByText("上傳完成")).toBeInTheDocument();
    expect(onParsed).toHaveBeenCalledWith(parsed, file);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("supports drag/drop and shows unsupported-schema errors", () => {
    const worker = fakeWorker();
    render(
      <TimelineUploader
        workerFactory={() => worker}
        onParsed={vi.fn()}
      />,
    );
    const file = new File(["{}"], "timeline.json", {
      type: "application/json",
    });

    fireEvent.drop(screen.getByTestId("timeline-dropzone"), {
      dataTransfer: { files: [file] },
    });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "parse", file });

    act(() =>
      worker.emit({
        type: "error",
        code: "unsupported_schema",
        message: "找不到 semanticSegments",
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "找不到 semanticSegments",
    );
  });
});

function fakeWorker(): TimelineWorkerLike & {
  emit: (message: unknown) => void;
} {
  const worker: TimelineWorkerLike & {
    emit: (message: unknown) => void;
  } = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
    emit(message) {
      worker.onmessage?.({ data: message } as MessageEvent);
    },
  };
  return worker;
}
