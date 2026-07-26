import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TransportModeSelect } from "@/components/timeline/transport-mode-select";

describe("TransportModeSelect", () => {
  it("renders the complete Taiwan catalog in labelled groups", () => {
    render(
      <TransportModeSelect
        region="taiwan"
        value="walking"
        onChange={vi.fn()}
      />,
    );

    expect(groupOptions("一般路線")).toEqual([
      ["walking", "步行"],
      ["running", "跑步"],
      ["cycling", "自行車"],
      ["motorcycling", "機車"],
      ["driving", "開車"],
    ]);
    expect(groupOptions("台灣大眾運輸")).toEqual([
      ["train", "鐵路（台鐵／高鐵，不限）"],
      ["taiwan-rail", "台鐵"],
      ["high-speed-rail", "高鐵"],
      ["bus", "公車／公路客運"],
      ["subway", "捷運"],
      ["tram", "輕軌"],
      ["ferry", "渡輪"],
      ["funicular", "纜車"],
    ]);
  });

  it("renders the complete international catalog in labelled groups", () => {
    render(
      <TransportModeSelect
        region="international"
        value="walking"
        onChange={vi.fn()}
      />,
    );

    expect(groupOptions("一般路線")).toHaveLength(5);
    expect(groupOptions("國外大眾運輸")).toEqual([
      ["transit", "大眾運輸（不限）"],
      ["rail", "鐵路（不限）"],
      ["high-speed-rail", "高速鐵路"],
      ["long-distance-rail", "長途鐵路"],
      ["night-rail", "夜行列車"],
      ["regional-rail", "區域鐵路"],
      ["suburban-rail", "市郊鐵路"],
      ["subway", "地鐵"],
      ["bus", "市區／短途公車"],
      ["coach", "長途客運"],
      ["tram", "路面電車"],
      ["ferry", "渡輪"],
      ["funicular", "登山纜車"],
      ["aerial-lift", "空中纜車"],
      ["other-transit", "其他大眾運輸"],
    ]);
  });

  it.each([
    ["taiwan", "transit", "train"],
    ["taiwan", "rail", "train"],
    ["international", "train", "rail"],
    ["international", "taiwan-rail", "rail"],
  ] as const)(
    "uses a valid broad fallback for %s mode %s",
    (region, value, expected) => {
      render(
        <TransportModeSelect
          region={region}
          value={value}
          onChange={vi.fn()}
        />,
      );

      expect(
        (screen.getByLabelText("修正交通方式") as HTMLSelectElement).value,
      ).toBe(expected);
    },
  );
});

function groupOptions(label: string): [string, string][] {
  return within(screen.getByRole("group", { name: label }))
    .getAllByRole("option")
    .map((option) => [
      (option as HTMLOptionElement).value,
      option.textContent ?? "",
    ]);
}
