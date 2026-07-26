import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  requestRepair,
  TimelineWorkflow,
  type TimelineWorkflowServices,
} from "@/app/timeline/page";
import type {
  processTimeline,
  ProcessTimelineResult,
} from "@/lib/timeline/process-timeline";
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

const twoGapParseResult: TimelineParseResult = {
  segments: [
    {
      id: "first-gap",
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T00:30:00Z",
      activity: {
        type: "WALKING",
        startPoint: { lat: 0, lon: 0 },
        endPoint: { lat: 0.1, lon: 0 },
      },
      timelinePath: [],
    },
    {
      id: "second-gap",
      startTime: "2026-01-02T00:00:00Z",
      endTime: "2026-01-02T00:30:00Z",
      activity: {
        type: "IN_PASSENGER_VEHICLE",
        startPoint: { lat: 1, lon: 0 },
        endPoint: { lat: 1.1, lon: 0 },
      },
      timelinePath: [],
    },
  ],
  dateRange: { min: "2026-01-01", max: "2026-01-02" },
  invalid: { coordinates: 0, missingTime: 0, segments: 0 },
};

const syntheticGap = {
  id: "synthetic-gap",
  startPoint: { lat: 0, lon: 0 },
  endPoint: { lat: 0.1, lon: 0.1 },
  startTime: "2026-01-01T00:00:00Z",
  endTime: "2026-01-01T00:10:00Z",
};

describe("requestRepair", () => {
  it.each([
    {
      status: 429,
      error: {
        code: "rate_limited",
        message: "Provider rate limit reached.",
        retryable: true,
      },
    },
    {
      status: 503,
      error: {
        code: "auth",
        message: "Provider authentication failed.",
        retryable: false,
      },
    },
  ] as const)(
    "preserves $error.code from route repair responses",
    async ({ status, error }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ error }, { status })),
      );

      await expect(
        requestRepair(syntheticGap, "driving"),
      ).rejects.toMatchObject({
        ...error,
        status,
      });

      vi.unstubAllGlobals();
    },
  );

  it("turns a non-JSON error response into a safe provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private upstream response", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(
      requestRepair(syntheticGap, "driving"),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "Provider is unavailable.",
      retryable: true,
      status: 502,
    });

    vi.unstubAllGlobals();
  });

  it("returns a validated route repair payload", async () => {
    const data = {
      points: [
        { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
        { lat: 0.1, lon: 0.1, time: "2026-01-01T00:10:00Z" },
      ],
      provenance: {
        kind: "ground-route",
        source: "openrouteservice",
        referenceDate: null,
        approximate: true,
        explanation: "Synthetic repaired route.",
        originalMode: "driving",
      },
      attempts: [
        {
          source: "openrouteservice",
          status: "success",
          message: "Synthetic repaired route.",
          retryable: false,
        },
      ],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data })),
    );

    await expect(
      requestRepair(syntheticGap, "driving"),
    ).resolves.toEqual(data);

    vi.unstubAllGlobals();
  });

  it("rejects a malformed success payload without exposing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: {
            privateProviderDetail: "must not escape",
          },
        }),
      ),
    );

    await expect(
      requestRepair(syntheticGap, "driving"),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "Provider is unavailable.",
      retryable: true,
      status: 200,
    });

    vi.unstubAllGlobals();
  });
});

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

  it("keeps unresolved work visible and withholds the partial download", async () => {
    const user = userEvent.setup();
    let resolveProcessing!: (result: ProcessTimelineResult) => void;
    const processFn = vi.fn((legs, _dependencies, options) => {
      options?.onProgress?.({
        current: 0,
        total: 1,
        message: "已完成 0/1",
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

    expect(screen.getByText("已完成 0/1")).toBeInTheDocument();
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
          providerAttempts: [
            {
              segmentId: gapId,
              source: "openrouteservice",
              status: "failed",
              message: "合成失敗",
              retryable: false,
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
      screen.queryByRole("heading", { name: "處理報告" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("時間軸記錄")).not.toBeInTheDocument();
    expect(screen.queryByText("Google 時間軸")).not.toBeInTheDocument();
    expect(screen.getAllByText(/合成失敗/)).toHaveLength(1);
    expect(
      screen.queryByText(/部分路段未能加入 GPX/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("progressbar"),
    ).toHaveAttribute("value", "0");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1");
    expect(screen.queryByText(/2.0 KB/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();
  });

  it("increments reviews in place and downloads only at full progress", async () => {
    const user = userEvent.setup();
    let invocation = 0;
    const processFn = vi.fn(
      async (
        legs: Parameters<typeof processTimeline>[0],
        _dependencies: Parameters<typeof processTimeline>[1],
        options: Parameters<typeof processTimeline>[2],
      ) => {
        invocation += 1;
        const gapIds = legs.flatMap((leg) =>
          leg.gaps.map((gap) => gap.id),
        );
        if (invocation === 1) {
          options?.onProgress?.({
            current: 0,
            total: gapIds.length,
            message: `已完成 0/${gapIds.length}`,
          });
          return result({
            report: {
              ...emptyReport(),
              unresolved: gapIds.map((segmentId) => ({
                segmentId,
                message: "需要人工確認",
              })),
            },
            partial: true,
          });
        }
        return result();
      },
    );
    renderWorkflow({
      workerFactory: () => worker(twoGapParseResult),
      processFn,
    });

    await upload(user);
    await screen.findByText("上傳完成");
    await user.click(screen.getByRole("radio", { name: "全部時間" }));
    await user.click(screen.getByRole("button", { name: "開始產生 GPX" }));

    expect(
      await screen.findByRole("heading", { name: "待人工確認路段" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "2");
    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "此路段不存在" }),
    );

    expect(processFn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "此路段不存在" }),
    );

    await waitFor(() => expect(processFn).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "2");
    expect(
      await screen.findByRole("link", {
        name: "下載 GPX 檔案：TimelineRoute260723.gpx",
      }),
    ).toHaveAttribute("download", "TimelineRoute260723.gpx");
  });

  it("shows each review card only its own repair failure", async () => {
    const user = userEvent.setup();
    const processFn = vi.fn(
      async (legs: Parameters<typeof processTimeline>[0]) => {
        const gapIds = legs.flatMap((leg) =>
          leg.gaps.map((gap) => gap.id),
        );
        return result({
          report: {
            ...emptyReport(),
            unresolved: gapIds.map((segmentId, index) => ({
              segmentId,
              message: `所有可用路線來源均失敗：第${index + 1}段失敗`,
            })),
            providerAttempts: gapIds.map((segmentId, index) => ({
              segmentId,
              source: "openrouteservice",
              status: "failed",
              message: `第${index + 1}段失敗`,
              retryable: false,
            })),
          },
          partial: true,
        });
      },
    );
    renderWorkflow({
      workerFactory: () => worker(twoGapParseResult),
      processFn,
    });

    await upload(user);
    await screen.findByText("上傳完成");
    await user.click(screen.getByRole("radio", { name: "全部時間" }));
    await user.click(screen.getByRole("button", { name: "開始產生 GPX" }));

    expect(await screen.findByText(/第1段失敗/)).toBeInTheDocument();
    expect(screen.queryByText(/第2段失敗/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一段" }));

    expect(screen.queryByText(/第1段失敗/)).not.toBeInTheDocument();
    expect(screen.getByText(/第2段失敗/)).toBeInTheDocument();
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
    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "處理報告" }),
    ).not.toBeInTheDocument();
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
