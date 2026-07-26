import {
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  TimelineWorkflow,
  type TimelineWorkflowServices,
} from "@/app/timeline/page";
import type { TimelineWorkerLike } from "@/components/timeline/timeline-uploader";
import type { ProcessTimelineResult } from "@/lib/timeline/process-timeline";
import type {
  TimelineProcessingEvent,
  TimelineProcessingSession,
} from "@/lib/timeline/process-timeline";
import type { ReviewQueueItem } from "@/lib/timeline/route-job";
import type { TimelineParseResult } from "@/lib/timeline/schema";

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

  it("appends live review events without resetting the current choice", async () => {
    const user = userEvent.setup();
    const controlled = controlledSession();
    renderWorkflow({ controlled });
    await startWorkflow(user);

    act(() => {
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("first", "第一段失敗"),
      });
    });

    expect(
      await screen.findByRole("heading", { name: "待人工確認路段" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消處理" }))
      .toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "修正交通方式" }),
      "bus",
    );

    act(() => {
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("second", "第二段失敗"),
      });
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("first", "重複事件"),
      });
    });

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(
      (screen.getByRole("combobox", {
        name: "修正交通方式",
      }) as HTMLSelectElement).value,
    ).toBe("bus");
    expect(screen.getByText(/第一段失敗/)).toBeInTheDocument();
    expect(screen.queryByText(/第二段失敗/)).not.toBeInTheDocument();
  });

  it("submits the chosen mode through the processing session", async () => {
    const user = userEvent.setup();
    const controlled = controlledSession();
    renderWorkflow({ controlled });
    await startWorkflow(user);
    act(() => {
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("reroute", "需要修正"),
      });
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "修正交通方式" }),
      "bus",
    );
    await user.click(screen.getByRole("button", { name: "重新查詢" }));

    expect(controlled.submitReview).toHaveBeenCalledWith({
      gapId: "reroute",
      action: "reroute",
      mode: "bus",
    });
  });

  it("announces persisted success before advancing to the next review", async () => {
    const user = userEvent.setup();
    const provider = deferred<void>();
    const persistence = deferred<void>();
    const controlled = controlledSession();
    controlled.submitReview.mockImplementation(async (decision) => {
      await provider.promise;
      await persistence.promise;
      controlled.emit({
        type: "route-succeeded",
        gapId: decision.gapId,
        lane: "openrouteservice",
      });
      controlled.emit({
        type: "review-removed",
        gapId: decision.gapId,
      });
    });
    renderWorkflow({ controlled });
    await startWorkflow(user);
    act(() => {
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("first", "第一段失敗"),
      });
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("second", "第二段失敗"),
      });
    });

    await user.click(screen.getByRole("button", { name: "重新查詢" }));
    expect(
      screen.queryByText("路段查詢成功，已加入輸出路線。"),
    ).not.toBeInTheDocument();

    await act(async () => {
      provider.resolve();
      await Promise.resolve();
    });
    expect(
      screen.queryByText("路段查詢成功，已加入輸出路線。"),
    ).not.toBeInTheDocument();

    await act(async () => {
      persistence.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByText("路段查詢成功，已加入輸出路線。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/第一段失敗/)).toBeInTheDocument();
    expect(screen.queryByText(/第二段失敗/)).not.toBeInTheDocument();

    expect(
      await screen.findByText(/第二段失敗/, {}, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", {
          name: "待人工確認路段",
        }),
      ).getByText("1 / 1"),
    ).toBeInTheDocument();
  });

  it("waits for finished and an empty review queue before offering download", async () => {
    const user = userEvent.setup();
    const controlled = controlledSession();
    renderWorkflow({ controlled });
    await startWorkflow(user);
    act(() => {
      controlled.emit({
        type: "progress",
        progress: {
          current: 0,
          total: 1,
          message: "已完成 0/1",
        },
      });
      controlled.emit({
        type: "review-enqueued",
        item: reviewItem("last", "最後一段失敗"),
      });
      controlled.automatic.resolve(
        result({ downloadable: false, gpx: null, partial: true }),
      );
    });

    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();

    act(() => {
      controlled.emit({ type: "review-removed", gapId: "last" });
      controlled.finished.resolve(result());
    });

    expect(
      await screen.findByRole("link", {
        name: "下載 GPX 檔案：TimelineRoute260723.gpx",
      }),
    ).toHaveAttribute("download", "TimelineRoute260723.gpx");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1");
  });

  it("cancels the active session and never exposes its incomplete GPX", async () => {
    const user = userEvent.setup();
    const controlled = controlledSession();
    controlled.cancel.mockImplementation(() => {
      controlled.finished.resolve(
        result({
          segments: [],
          gpx: null,
          downloadable: false,
          canceled: true,
        }),
      );
    });
    renderWorkflow({ controlled });
    await startWorkflow(user);

    await user.click(screen.getByRole("button", { name: "取消處理" }));

    expect(controlled.cancel).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "取消處理" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();
  });
});

function renderWorkflow({
  controlled = controlledSession(),
}: {
  controlled?: ReturnType<typeof controlledSession>;
} = {}) {
  const startProcessingFn = vi.fn(() => controlled.session);
  return {
    controlled,
    startProcessingFn,
    rendered: render(
      <TimelineWorkflow
        workerFactory={() => worker()}
        services={services()}
        startProcessingFn={startProcessingFn}
        createDownloadFn={() => ({
          url: "blob:synthetic",
          filename: "TimelineRoute260723.gpx",
          size: 2_048,
        })}
      />,
    ),
  };
}

async function startWorkflow(user: ReturnType<typeof userEvent.setup>) {
  await upload(user);
  await screen.findByText("上傳完成");
  await user.click(screen.getByRole("radio", { name: "全部時間" }));
  await user.click(screen.getByRole("button", { name: "開始產生 GPX" }));
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("選擇 Google 時間軸 JSON"),
    new File(["{}"], "timeline.json", { type: "application/json" }),
  );
}

function controlledSession() {
  const listeners = new Set<
    (event: TimelineProcessingEvent) => void
  >();
  const automatic = deferred<ProcessTimelineResult>();
  const finished = deferred<ProcessTimelineResult>();
  const submitReview = vi.fn<
    TimelineProcessingSession["submitReview"]
  >().mockResolvedValue(undefined);
  const cancel = vi.fn();
  const session: TimelineProcessingSession = {
    automaticDone: automatic.promise,
    finished: finished.promise,
    submitReview,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel,
  };
  return {
    automatic,
    finished,
    submitReview,
    cancel,
    session,
    emit(event: TimelineProcessingEvent) {
      listeners.forEach((listener) => listener(event));
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function reviewItem(
  id: string,
  message: string,
): ReviewQueueItem {
  return {
    gap: {
      id,
      mode: "driving",
      startPoint: { lat: 35.6812, lon: 139.7671 },
      endPoint: { lat: 35.6896, lon: 139.7006 },
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T00:30:00Z",
      distanceMeters: 5_000,
      elapsedMilliseconds: 1_800_000,
    },
    originalMode: "driving",
    attemptedMode: "driving",
    lane: "openrouteservice",
    attempts: [
      {
        source: "openrouteservice",
        status: "failed",
        message,
        retryable: false,
      },
    ],
  };
}

function worker(result = parseResult): TimelineWorkerLike {
  const fake: TimelineWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(() => {
      queueMicrotask(() => {
        fake.onmessage?.({
          data: { type: "complete", result },
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
    report: {
      automaticSuccess: [],
      userCorrectedSuccess: [],
      userExcluded: [],
      skippedFlights: [],
      unresolved: [],
      invalidData: [],
      providerAttempts: [],
    },
    gpx: "<gpx />",
    downloadable: true,
    partial: false,
    warning: null,
    canceled: false,
    ...overrides,
  };
}
