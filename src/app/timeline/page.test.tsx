import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  TimelineWorkflow,
  type TimelineWorkflowServices,
} from "@/app/timeline/page";
import type { ProcessTimelineResult } from "@/lib/timeline/process-timeline";
import type { TimelineParseResult } from "@/lib/timeline/schema";
import type { TimelineWorkerLike } from "@/components/timeline/timeline-uploader";

const parseResult: TimelineParseResult = {
  segments: [
    {
      id: "synthetic",
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-03T01:00:00Z",
      activity: {
        type: "WALKING",
        startPoint: { lat: 0, lon: 0 },
        endPoint: { lat: 1, lon: 1 },
      },
      timelinePath: [],
    },
  ],
  dateRange: { min: "2026-01-01", max: "2026-01-03" },
  invalid: { coordinates: 0, missingTime: 0, segments: 0 },
};

describe("TimelineWorkflow", () => {
  it("uploads, discovers dates, and only offers export after a date choice", async () => {
    const user = userEvent.setup();
    renderWorkflow();

    expect(
      screen.getByRole("heading", { name: "上傳你的 Google 時間軸" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "開始產生 GPX" }),
    ).not.toBeInTheDocument();

    await upload(user);

    expect(await screen.findByText("上傳完成")).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01.*2026-01-03/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "開始產生 GPX" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "全部時間" }));
    expect(
      screen.getByRole("button", { name: "開始產生 GPX" }),
    ).toBeInTheDocument();
  });

  it("shows progress/cancel, review, all-source failures, partial warning, size, and download", async () => {
    const user = userEvent.setup();
    let resolveProcessing!: (result: ProcessTimelineResult) => void;
    const processFn = vi.fn((legs, _dependencies, options) => {
      options?.onProgress?.({
        stage: "repair",
        current: 1,
        total: 1,
        message: "修補路段 1/1",
      });
      return new Promise<ProcessTimelineResult>((resolve) => {
        resolveProcessing = resolve;
      });
    });
    renderWorkflow({ processFn });
    await upload(user);
    await screen.findByText("上傳完成");
    await user.click(screen.getByRole("radio", { name: "全部時間" }));
    await user.click(screen.getByRole("button", { name: "開始產生 GPX" }));

    expect(screen.getByText("修補路段 1/1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消處理" })).toBeInTheDocument();

    const legs = processFn.mock.calls[0][0];
    const gapId = legs[0].gaps[0].id;
    resolveProcessing(
      result({
        report: {
          ...emptyReport(),
          unresolved: [
            {
              segmentId: gapId,
              message: "所有可用路線來源均失敗：合成失敗",
            },
          ],
        },
        partial: true,
        warning: "部分路段未能加入 GPX；下載前請查看處理報告。",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "待人工確認路段" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "處理報告" }),
    ).toBeInTheDocument();
    expect(screen.getByText("所有來源皆失敗")).toBeInTheDocument();
    expect(screen.getByText(/合成失敗/)).toBeInTheDocument();
    expect(screen.getByText(/部分路段未能加入 GPX/)).toBeInTheDocument();
    expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下載 GPX" })).toHaveAttribute(
      "download",
      "TimelineRoute260723.gpx",
    );
  });

  it("aborts processing and exposes no download for zero routes", async () => {
    const user = userEvent.setup();
    let observedSignal: AbortSignal | undefined;
    let resolveProcessing!: (result: ProcessTimelineResult) => void;
    const processFn = vi.fn((_legs, _dependencies, options) => {
      observedSignal = options?.signal;
      return new Promise<ProcessTimelineResult>((resolve) => {
        resolveProcessing = resolve;
      });
    });
    renderWorkflow({ processFn });
    await upload(user);
    await screen.findByText("上傳完成");
    await user.click(screen.getByRole("radio", { name: "全部時間" }));
    await user.click(screen.getByRole("button", { name: "開始產生 GPX" }));
    await user.click(screen.getByRole("button", { name: "取消處理" }));
    expect(observedSignal?.aborted).toBe(true);
    resolveProcessing(
      result({
        segments: [],
        gpx: null,
        downloadable: false,
        canceled: true,
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText("取消處理")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "下載 GPX" })).not.toBeInTheDocument();
    expect(screen.getByText("沒有可匯出的路線。")).toBeInTheDocument();
  });
});

function renderWorkflow(
  overrides: Partial<
    React.ComponentProps<typeof TimelineWorkflow>
  > = {},
) {
  return render(
    <TimelineWorkflow
      workerFactory={() => worker()}
      services={services()}
      createDownloadFn={() => ({
        url: "blob:synthetic",
        filename: "TimelineRoute260723.gpx",
        size: 2_048,
      })}
      {...overrides}
    />,
  );
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("選擇 Google 時間軸 JSON"),
    new File(["{}"], "timeline.json", { type: "application/json" }),
  );
}

function worker(): TimelineWorkerLike {
  const fake: TimelineWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(() => {
      queueMicrotask(() => {
        fake.onmessage?.({
          data: { type: "complete", result: parseResult },
        } as MessageEvent);
      });
    }),
    terminate: vi.fn(),
  };
  return fake;
}

function services(): TimelineWorkflowServices {
  return {
    dependencies: {
      getCorrection: vi.fn().mockResolvedValue(null),
      getCachedRoute: vi.fn().mockResolvedValue(null),
      putCachedRoute: vi.fn().mockResolvedValue(undefined),
      repair: vi.fn(),
    },
    correctionStore: {
      get: vi.fn().mockResolvedValue(null),
      saveExclusion: vi.fn().mockResolvedValue(undefined),
      saveReroute: vi.fn().mockResolvedValue(undefined),
    },
    close: vi.fn(),
  };
}

function result(
  overrides: Partial<ProcessTimelineResult> = {},
): ProcessTimelineResult {
  return {
    segments: [
      {
        id: "recorded",
        name: "合成記錄",
        mode: "walking",
        points: [
          { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
          { lat: 0.005, lon: 0, time: "2026-01-01T00:05:00Z" },
        ],
        provenance: {
          kind: "recorded-timeline",
          source: "google-timeline",
          referenceDate: "2026-01-01",
          approximate: false,
          explanation: "合成",
        },
      },
    ],
    report: emptyReport(),
    gpx: "<gpx />",
    downloadable: true,
    partial: false,
    warning: null,
    canceled: false,
    ...overrides,
  };
}

function emptyReport() {
  return {
    automaticSuccess: [],
    userCorrectedSuccess: [],
    userExcluded: [],
    skippedFlights: [],
    unresolved: [],
    invalidData: [],
    providerAttempts: [],
  };
}
