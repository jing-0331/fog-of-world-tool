import { describe, expect, it, vi } from "vitest";

import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import {
  ProviderError,
  providerErrorFromStatus,
  serializeProviderError,
} from "@/lib/server/provider-error";

describe("fetchWithRetry", () => {
  it("retries network errors at most three total attempts", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("socket failed"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithRetry("https://provider.invalid", undefined, {
        fetchFn,
        sleep,
      }),
    ).rejects.toMatchObject({ code: "network", retryable: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx responses and returns the first success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithRetry(
      "https://provider.invalid",
      undefined,
      { fetchFn, sleep: vi.fn().mockResolvedValue(undefined) },
    );

    expect(await response.text()).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After on a 429 response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await fetchWithRetry("https://provider.invalid", undefined, {
      fetchFn,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("does not wait for a Retry-After beyond the interactive retry budget", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithRetry("https://provider.invalid", undefined, {
        fetchFn,
        sleep,
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403])("does not retry status %s", async (status) => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status }));

    await expect(
      fetchWithRetry("https://provider.invalid", undefined, {
        fetchFn,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("provider errors", () => {
  it.each([
    [404, "no_data"],
    [429, "rate_limited"],
    [401, "auth"],
    [402, "quota"],
    [503, "provider_unavailable"],
  ] as const)("classifies status %s as %s", (status, code) => {
    expect(providerErrorFromStatus(status).code).toBe(code);
  });

  it("serializes only safe fields", () => {
    const error = new ProviderError({
      code: "provider_unavailable",
      message: "Provider unavailable",
      retryable: true,
      internalDetail:
        'body={"start":[25.1234,121.5678],"secret":"do-not-return"}',
    });

    const serialized = JSON.stringify(serializeProviderError(error));

    expect(serialized).toBe(
      '{"error":{"code":"provider_unavailable","message":"Provider unavailable","retryable":true}}',
    );
    expect(serialized).not.toContain("25.1234");
    expect(serialized).not.toContain("121.5678");
    expect(serialized).not.toContain("do-not-return");
  });
});
