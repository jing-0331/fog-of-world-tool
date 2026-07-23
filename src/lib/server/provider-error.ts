import type { ProviderErrorCode } from "@/lib/domain/types";

interface ProviderErrorOptions {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
  internalDetail?: string;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly internalDetail?: string;

  constructor({
    code,
    message,
    retryable,
    status,
    internalDetail,
  }: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.internalDetail = internalDetail;
  }
}

export function providerErrorFromStatus(status: number): ProviderError {
  if (status === 404) {
    return new ProviderError({
      code: "no_data",
      message: "Provider returned no matching data.",
      retryable: false,
      status,
    });
  }
  if (status === 429) {
    return new ProviderError({
      code: "rate_limited",
      message: "Provider rate limit reached.",
      retryable: true,
      status,
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderError({
      code: "auth",
      message: "Provider authentication failed.",
      retryable: false,
      status,
    });
  }
  if (status === 402) {
    return new ProviderError({
      code: "quota",
      message: "Provider quota is exhausted.",
      retryable: false,
      status,
    });
  }

  return new ProviderError({
    code: "provider_unavailable",
    message: "Provider is unavailable.",
    retryable: status >= 500,
    status,
  });
}

export function networkProviderError(internalDetail?: string): ProviderError {
  return new ProviderError({
    code: "network",
    message: "Provider network request failed.",
    retryable: true,
    internalDetail,
  });
}

export function serializeProviderError(error: ProviderError): {
  error: { code: ProviderErrorCode; message: string; retryable: boolean };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export function asProviderError(error: unknown): ProviderError {
  return error instanceof ProviderError
    ? error
    : networkProviderError(error instanceof Error ? error.name : undefined);
}
