import { describe, expect, it } from "vitest";

import { routePolicy } from "@/lib/routing/mode-policy";

describe("Taiwan transit provider selection", () => {
  const transitProvider = (
    startPoint: { lat: number; lon: number },
    endPoint: { lat: number; lon: number },
  ) =>
    (
      routePolicy as unknown as (
        mode: "bus",
        start: typeof startPoint,
        end: typeof endPoint,
      ) => { provider: string } | null
    )("bus", startPoint, endPoint)?.provider;

  it.each([
    [
      "Taiwan proper",
      { lat: 25.0478, lon: 121.5319 },
      { lat: 22.6273, lon: 120.3014 },
    ],
    [
      "Penghu",
      { lat: 23.5655, lon: 119.5863 },
      { lat: 23.5712, lon: 119.5793 },
    ],
    [
      "Kinmen",
      { lat: 24.4321, lon: 118.3171 },
      { lat: 24.4471, lon: 118.3765 },
    ],
    [
      "Matsu",
      { lat: 26.1605, lon: 119.9517 },
      { lat: 26.2243, lon: 120.0026 },
    ],
  ])("uses TDX when both endpoints are in %s", (_region, start, end) => {
    expect(transitProvider(start, end)).toBe("tdx");
  });

  it("keeps overseas transit on Transitous", () => {
    expect(
      transitProvider(
        { lat: 35.6812, lon: 139.7671 },
        { lat: 35.4437, lon: 139.638 },
      ),
    ).toBe("transitous");
  });

  it("does not send a cross-border route to TDX", () => {
    expect(
      transitProvider(
        { lat: 25.0478, lon: 121.5319 },
        { lat: 35.6812, lon: 139.7671 },
      ),
    ).toBe("transitous");
  });

  it("does not mistake nearby non-Taiwan points for Taiwan", () => {
    expect(
      transitProvider(
        { lat: 24.4798, lon: 118.0894 },
        { lat: 24.5023, lon: 118.1354 },
      ),
    ).toBe("transitous");
  });
});
