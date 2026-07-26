import { describe, expect, it, vi } from "vitest";

import { createRateLimitedFetch } from "@/lib/server/rate-limited-fetch";

describe("createRateLimitedFetch", () => {
  it("acquires a limiter slot before every fetch attempt", async () => {
    const order: string[] = [];
    const limiter = {
      acquire: vi.fn(async () => {
        order.push("acquire");
      }),
    };
    const fetchFn = vi.fn(async () => {
      order.push("fetch");
      return new Response("{}", { status: 200 });
    });
    const wrapped = createRateLimitedFetch(fetchFn, limiter);

    await wrapped("https://example.com/one");
    await wrapped("https://example.com/two");

    expect(order).toEqual([
      "acquire",
      "fetch",
      "acquire",
      "fetch",
    ]);
    expect(limiter.acquire).toHaveBeenCalledTimes(2);
  });

  it("passes the request signal to the limiter", async () => {
    const controller = new AbortController();
    const limiter = { acquire: vi.fn().mockResolvedValue(undefined) };
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const wrapped = createRateLimitedFetch(fetchFn, limiter);

    await wrapped("https://example.com", {
      signal: controller.signal,
    });

    expect(limiter.acquire).toHaveBeenCalledWith(controller.signal);
  });
});
