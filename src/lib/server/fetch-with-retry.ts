import {
  networkProviderError,
  providerErrorFromStatus,
} from "@/lib/server/provider-error";

interface FetchWithRetryOptions {
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMilliseconds?: number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get("Retry-After");
  if (value === null) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const dateMilliseconds = Date.parse(value);
  return Number.isFinite(dateMilliseconds)
    ? Math.max(0, dateMilliseconds - Date.now())
    : null;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  {
    fetchFn = fetch,
    sleep = defaultSleep,
    maxAttempts = 3,
    baseDelayMilliseconds = 150,
  }: FetchWithRetryOptions = {},
): Promise<Response> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchFn(input, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      const providerError = networkProviderError(
        error instanceof Error ? error.name : undefined,
      );
      if (attempt === maxAttempts) {
        throw providerError;
      }
      await sleep(baseDelayMilliseconds * 2 ** (attempt - 1));
      continue;
    }

    if (response.ok) {
      return response;
    }

    const providerError = providerErrorFromStatus(response.status);
    if (!providerError.retryable || attempt === maxAttempts) {
      throw providerError;
    }
    await sleep(
      retryAfterMilliseconds(response) ??
        baseDelayMilliseconds * 2 ** (attempt - 1),
    );
  }

  throw networkProviderError();
}
