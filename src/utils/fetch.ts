/**
 * Shared fetch utilities for 8spine modules
 */

export interface FetchOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  contextLabel?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Fetch JSON with error handling and timeout support
 */
export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': '8spine/1.0',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch with exponential backoff retry on rate limit (429) and timeout support
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: RetryConfig = {}
): Promise<Response> {
  const maxRetries = config.maxRetries ?? 5;
  const baseDelay = config.baseDelay ?? 1000;
  const maxDelay = config.maxDelay ?? 30000;
  const contextLabel = config.contextLabel ?? 'API call';
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  let attempt = 0;

  while (attempt < maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (resp.status !== 429) {
        return resp;
      }

      attempt++;

      if (attempt >= maxRetries) {
        throw new Error(`Rate limit exceeded after ${maxRetries} attempts`);
      }

      const waitTime = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      console.log(
        `[8spine] Rate limited (429) for ${contextLabel}, waiting ${waitTime}ms... (Attempt ${attempt}/${maxRetries})`
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms for ${contextLabel}`);
      }
      throw error;
    }
  }

  throw new Error('Rate limit retry failed');
}
