import { describe, expect, it } from "vitest";

import { readServerEnv } from "@/lib/server/env";

describe("readServerEnv", () => {
  it("defaults the TDX rolling limit to five requests per minute", () => {
    expect(readServerEnv({}).TDX_REQUESTS_PER_MINUTE).toBe(5);
  });

  it.each([
    ["1", true],
    ["5", true],
    ["20", true],
    ["0", false],
    ["1.5", false],
    ["not-a-number", false],
  ])("validates TDX_REQUESTS_PER_MINUTE=%s", (value, valid) => {
    const parse = () =>
      readServerEnv({ TDX_REQUESTS_PER_MINUTE: value });
    if (valid) {
      expect(parse().TDX_REQUESTS_PER_MINUTE).toBe(Number(value));
    } else {
      expect(parse).toThrow();
    }
  });

  it("defaults the Transitous courtesy interval to five seconds", () => {
    expect(readServerEnv({}).TRANSITOUS_MIN_INTERVAL_MS).toBe(5_000);
  });

  it.each([
    ["999", false],
    ["1000", true],
    ["5000", true],
    ["60000", true],
    ["60001", false],
    ["1.5", false],
    ["not-a-number", false],
  ])(
    "validates TRANSITOUS_MIN_INTERVAL_MS=%s",
    (value, valid) => {
      const parse = () =>
        readServerEnv({ TRANSITOUS_MIN_INTERVAL_MS: value });
      if (valid) {
        expect(parse().TRANSITOUS_MIN_INTERVAL_MS).toBe(Number(value));
      } else {
        expect(parse).toThrow();
      }
    },
  );
});
