import {
  getRetryDelayMs,
  isRateLimitedError,
  MAX_429_RETRIES,
} from '../lambda/ingestion/massiveRateLimiter';
import { MASSIVE_REQUEST_INTERVAL_MS, MAX_RETRY_DELAY_MS } from '../lambda/ingestion/config';

describe('massiveRateLimiter', () => {
  test('exposes the configured max retries', () => {
    expect(MAX_429_RETRIES).toBe(4);
  });

  test('detects 429 rate limit errors', () => {
    expect(isRateLimitedError({ response: { status: 429 } })).toBe(true);
    expect(isRateLimitedError({ response: { status: 500 } })).toBe(false);
    expect(isRateLimitedError(new Error('boom'))).toBe(false);
  });

  test('uses numeric retry-after header when present', () => {
    const delay = getRetryDelayMs(1, {
      response: {
        headers: {
          'retry-after': 3,
        },
      },
    });

    expect(delay).toBe(3000);
  });

  test('uses case-insensitive string retry-after header when present', () => {
    const delay = getRetryDelayMs(2, {
      response: {
        headers: {
          'Retry-After': '2',
        },
      },
    });

    expect(delay).toBe(2000);
  });

  test('falls back to capped exponential backoff when retry-after is absent', () => {
    const delay = getRetryDelayMs(10, {
      response: {
        headers: {},
      },
    });

    const expectedExponential = MASSIVE_REQUEST_INTERVAL_MS * 2 ** (10 - 1);
    expect(delay).toBe(Math.min(expectedExponential, MAX_RETRY_DELAY_MS));
  });
});
