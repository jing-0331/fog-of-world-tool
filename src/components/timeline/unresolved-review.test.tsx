import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  UnresolvedReview,
  type UnresolvedReviewItem,
} from "@/components/timeline/unresolved-review";
import type { CorrectionStore } from "@/lib/client/correction-store";

const item: UnresolvedReviewItem = {
  gap: {
    id: "gap-1",
    mode: "driving",
    startPoint: { lat: 25.1, lon: 121.5 },
    endPoint: { lat: 25.2, lon: 121.6 },
    startTime: "2026-01-01T08:00:00+08:00",
    endTime: "2026-01-01T09:30:00+08:00",
    distanceMeters: 15_400,
    elapsedMilliseconds: 5_400_000,
  },
  originalMode: "driving",
  startLocation: "合成起點",
  attempts: [
    {
      source: "openrouteservice",
      status: "failed",
      code: "network",
      message: "網路失敗",
      retryable: true,
    },
    {
      source: "transitous",
      status: "failed",
      code: "no_data",
      message: "沒有班次",
      retryable: false,
    },
  ],
  warning: "probable-flight",
};

describe("UnresolvedReview", () => {
  it("appears only after automatic processing and shows complete review evidence", () => {
    const props = baseProps();
    const { rerender } = render(
      <UnresolvedReview {...props} processing items={[item]} />,
    );

    expect(
      screen.queryByRole("heading", { name: "待人工確認路段" }),
    ).not.toBeInTheDocument();

    rerender(<UnresolvedReview {...props} processing={false} items={[item]} />);

    expect(
      screen.getByRole("heading", { name: "待人工確認路段" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01 08:00/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01 09:30/)).toBeInTheDocument();
    expect(screen.getByText("合成起點")).toBeInTheDocument();
    expect(screen.getByText("25.20000, 121.60000")).toBeInTheDocument();
    expect(screen.getByText(/15.4 公里/)).toBeInTheDocument();
    expect(screen.getByText(/1 小時 30 分鐘/)).toBeInTheDocument();
    expect(screen.getByText(/原始 Google 交通方式：開車/)).toBeInTheDocument();
    expect(screen.getByText(/OpenRouteService.*網路失敗/)).toBeInTheDocument();
    expect(screen.getByText(/Transitous.*沒有班次/)).toBeInTheDocument();
    expect(screen.getByText(/可能是飛行或位置異常/)).toBeInTheDocument();
  });

  it("reroutes one card and records user-corrected provenance", async () => {
    const user = userEvent.setup();
    const correctionStore = store();
    const onDecision = vi.fn();
    const retry = vi.fn().mockResolvedValue({
      points: [
        { lat: 25.1, lon: 121.5 },
        { lat: 25.2, lon: 121.6 },
      ],
      provenance: {
        kind: "transit-route",
        source: "transitous",
        referenceDate: "2026-07-23",
        approximate: true,
        explanation: "合成大眾運輸",
      },
      attempts: [],
    });
    render(
      <UnresolvedReview
        processing={false}
        items={[item]}
        correctionStore={correctionStore}
        retry={retry}
        onDecision={onDecision}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "修正交通方式" }),
      "bus",
    );
    await user.click(screen.getByRole("button", { name: "重新查詢" }));

    await waitFor(() =>
      expect(correctionStore.saveReroute).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentId: "gap-1",
          originalMode: "driving",
          correctedMode: "bus",
          normalizedRoute: expect.objectContaining({
            provenance: expect.objectContaining({
              source: "transitous",
              originalMode: "driving",
              correctedMode: "bus",
              userOverride: true,
            }),
          }),
        }),
      ),
    );
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reroute",
        segmentId: "gap-1",
      }),
    );
    expect(screen.getByText("所有待確認路段都已處理。")).toBeInTheDocument();
  });

  it("stores intentional exclusion, while skip leaves the item unresolved", async () => {
    const user = userEvent.setup();
    const correctionStore = store();
    const props = baseProps({ correctionStore });
    const { rerender } = render(
      <UnresolvedReview {...props} items={[item]} />,
    );

    await user.click(screen.getByRole("button", { name: "暫時略過" }));
    expect(correctionStore.saveExclusion).not.toHaveBeenCalled();
    expect(screen.getByText(/原始 Google 交通方式：開車/)).toBeInTheDocument();

    rerender(<UnresolvedReview {...props} items={[item]} />);
    await user.click(screen.getByRole("button", { name: "此路段不存在" }));

    await waitFor(() =>
      expect(correctionStore.saveExclusion).toHaveBeenCalledWith({
        segmentId: "gap-1",
        originalMode: "driving",
      }),
    );
  });

  it("keeps a failed retry in the queue", async () => {
    const user = userEvent.setup();
    render(
      <UnresolvedReview
        {...baseProps({
          retry: vi.fn().mockRejectedValue(new Error("仍然找不到路線")),
        })}
        items={[item]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "重新查詢" }));

    expect(await screen.findByText("仍然找不到路線")).toBeInTheDocument();
    expect(screen.getByText(/原始 Google 交通方式：開車/)).toBeInTheDocument();
  });
});

function store(): CorrectionStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    saveExclusion: vi.fn().mockResolvedValue(undefined),
    saveReroute: vi.fn().mockResolvedValue(undefined),
  };
}

function baseProps(
  overrides: Partial<React.ComponentProps<typeof UnresolvedReview>> = {},
): React.ComponentProps<typeof UnresolvedReview> {
  return {
    processing: false,
    items: [],
    correctionStore: store(),
    retry: vi.fn(),
    ...overrides,
  };
}
