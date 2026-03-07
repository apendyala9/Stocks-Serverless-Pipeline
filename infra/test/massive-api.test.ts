const mockScheduleMassiveRequest = jest.fn();
const mockIsRateLimitedError = jest.fn();
const mockGetRetryDelayMs = jest.fn();
const mockSleep = jest.fn();

jest.mock('../lambda/ingestion/massiveRateLimiter', () => ({
  MAX_429_RETRIES: 4,
  scheduleMassiveRequest: (request: () => Promise<unknown>) => mockScheduleMassiveRequest(request),
  isRateLimitedError: (error: unknown) => mockIsRateLimitedError(error),
  getRetryDelayMs: (attempt: number, error: unknown) => mockGetRetryDelayMs(attempt, error),
  sleep: (ms: number) => mockSleep(ms),
}));

import { calculatePercentChange, fetchTickerForDate } from '../lambda/ingestion/massiveApi';

describe('massiveApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduleMassiveRequest.mockImplementation(async (request: () => Promise<unknown>) => request());
    mockIsRateLimitedError.mockImplementation(
      (error: { response?: { status?: number } }) => error?.response?.status === 429
    );
    mockGetRetryDelayMs.mockReturnValue(250);
    mockSleep.mockResolvedValue(undefined);
  });

  test('calculates percent change', () => {
    expect(calculatePercentChange(100, 110)).toBeCloseTo(10);
    expect(calculatePercentChange(100, 90)).toBeCloseTo(-10);
  });

  test('returns parsed ticker result when response is valid', async () => {
    const rest = {
      getStocksOpenClose: jest.fn().mockResolvedValue({
        status: 'OK',
        symbol: 'AAPL',
        open: 100,
        close: 110,
      }),
    };

    const result = await fetchTickerForDate(rest as never, 'AAPL', '2026-03-06');

    expect(result).toEqual({
      symbol: 'AAPL',
      open: 100,
      close: 110,
      percentChange: 10,
    });
  });

  test('returns null for invalid payloads', async () => {
    const rest = {
      getStocksOpenClose: jest.fn().mockResolvedValue({
        status: 'NOT_OK',
      }),
    };

    const result = await fetchTickerForDate(rest as never, 'AAPL', '2026-03-06');
    expect(result).toBeNull();
  });

  test('retries on 429 and succeeds on subsequent attempt', async () => {
    const rest = {
      getStocksOpenClose: jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({
          status: 'OK',
          symbol: 'AAPL',
          open: 100,
          close: 105,
        }),
    };

    const result = await fetchTickerForDate(rest as never, 'AAPL', '2026-03-06');

    expect(result).toEqual({
      symbol: 'AAPL',
      open: 100,
      close: 105,
      percentChange: 5,
    });
    expect(mockGetRetryDelayMs).toHaveBeenCalledWith(1, { response: { status: 429 } });
    expect(mockSleep).toHaveBeenCalledWith(250);
  });

  test('returns null immediately for non-rate-limited errors', async () => {
    const rest = {
      getStocksOpenClose: jest.fn().mockRejectedValue(new Error('network issue')),
    };

    const result = await fetchTickerForDate(rest as never, 'AAPL', '2026-03-06');

    expect(result).toBeNull();
    expect(mockSleep).not.toHaveBeenCalled();
  });
});
