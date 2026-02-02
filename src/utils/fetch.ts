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
}

/**
 * Fetch JSON with error handling
 */
export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const response = await fetch(url, {
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
}

/**
 * Fetch with exponential backoff retry on rate limit (429)
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

  let attempt = 0;

  while (attempt < maxRetries) {
    const resp = await fetch(url, options);

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
  }

  throw new Error('Rate limit retry failed');
}
