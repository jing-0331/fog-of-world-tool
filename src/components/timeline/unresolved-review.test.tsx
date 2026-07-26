import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  UnresolvedReview,
  type UnresolvedReviewItem,
} from "@/components/timeline/unresolved-review";

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
  it.each([
    [
      "Taiwan",
      item,
      "台灣大眾運輸",
      "鐵路（台鐵／高鐵，不限）",
    ],
    [
      "overseas",
      {
        ...item,
        gap: {
          ...item.gap,
          startPoint: { lat: 35.6812, lon: 139.7671 },
          endPoint: { lat: 35.6896, lon: 139.7006 },
        },
      },
      "國外大眾運輸",
      "大眾運輸（不限）",
    ],
    [
      "cross-border",
      {
        ...item,
        gap: {
          ...item.gap,
          endPoint: { lat: 35.6812, lon: 139.7671 },
        },
      },
      "國外大眾運輸",
      "大眾運輸（不限）",
    ],
  ] as const)(
    "derives the %s choices only from both endpoints",
    (_name, reviewItem, groupLabel, optionLabel) => {
      render(
        <UnresolvedReview
          items={[reviewItem]}
          submitReview={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("group", { name: groupLabel }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: optionLabel }),
      ).toBeInTheDocument();
    },
  );

  it("shows complete review evidence", () => {
    render(
      <UnresolvedReview items={[item]} submitReview={vi.fn()} />,
    );

    expect(
      screen.getByRole("heading", { name: "待人工確認路段" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01 08:00/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01 09:30/)).toBeInTheDocument();
    expect(screen.getByText("25.10000, 121.50000")).toBeInTheDocument();
    expect(screen.getByText("25.20000, 121.60000")).toBeInTheDocument();
    expect(screen.getByText(/15.4 公里/)).toBeInTheDocument();
    expect(screen.getByText(/1 小時 30 分鐘/)).toBeInTheDocument();
    expect(screen.getByText(/原始 Google 交通方式：開車/))
      .toBeInTheDocument();
    expect(screen.getByText(/OpenRouteService.*網路失敗/))
      .toBeInTheDocument();
    expect(screen.getByText(/Transitous.*沒有班次/))
      .toBeInTheDocument();
    expect(screen.getByText(/可能是飛行或位置異常/))
      .toBeInTheDocument();
  });

  it("submits reroute and exclusion decisions to the session", async () => {
    const user = userEvent.setup();
    const submitReview = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <UnresolvedReview
        items={[item]}
        submitReview={submitReview}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "修正交通方式" }),
      "bus",
    );
    await user.click(screen.getByRole("button", { name: "重新查詢" }));
    expect(submitReview).toHaveBeenCalledWith({
      gapId: "gap-1",
      action: "reroute",
      mode: "bus",
    });

    rerender(
      <UnresolvedReview
        items={[item]}
        submitReview={submitReview}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "此路段不存在" }),
    );
    expect(submitReview).toHaveBeenCalledWith({
      gapId: "gap-1",
      action: "exclude",
    });
  });

  it("keeps a failed manual repair in the queue", async () => {
    const user = userEvent.setup();
    render(
      <UnresolvedReview
        items={[item]}
        submitReview={vi
          .fn()
          .mockRejectedValue(new Error("仍然找不到路線"))}
      />,
    );

    await user.click(screen.getByRole("button", { name: "重新查詢" }));

    expect(await screen.findByText("仍然找不到路線"))
      .toBeInTheDocument();
    expect(screen.getByText(/原始 Google 交通方式：開車/))
      .toBeInTheDocument();
  });

  it("postpones without submitting or completing an item", async () => {
    const user = userEvent.setup();
    const submitReview = vi.fn();
    render(
      <UnresolvedReview
        items={[item, { ...item, gap: { ...item.gap, id: "gap-2" } }]}
        submitReview={submitReview}
      />,
    );

    await user.click(screen.getByRole("button", { name: "暫時略過" }));

    expect(submitReview).not.toHaveBeenCalled();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("renders the persisted-success announcement as a live status", () => {
    render(
      <UnresolvedReview
        items={[item]}
        submitReview={vi.fn()}
        successMessage="路段查詢成功，已加入輸出路線。"
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "路段查詢成功，已加入輸出路線。",
      }),
    ).toBeInTheDocument();
  });
});
