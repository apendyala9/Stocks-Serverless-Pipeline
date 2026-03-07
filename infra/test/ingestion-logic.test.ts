const loadIngestionLogicWithMocks = async () => {
  jest.resetModules();

  const mockFetchTickerForDate = jest.fn();
  const mockStoreResultsForDate = jest.fn();
  const mockGetDateWithLookback = jest.fn((lookback: number) => `2026-03-${String(10 - lookback)}`);

  jest.doMock('../lambda/ingestion/config', () => ({
    WATCHLIST: ['AAPL', 'MSFT'],
    HISTORY_DAYS: 2,
    MAX_HISTORY_LOOKBACK_DAYS: 5,
    MAX_LOOKBACK_DAYS: 3,
  }));

  jest.doMock('../lambda/ingestion/massiveApi', () => ({
    fetchTickerForDate: mockFetchTickerForDate,
  }));

  jest.doMock('../lambda/ingestion/dynamo', () => ({
    storeResultsForDate: mockStoreResultsForDate,
  }));

  jest.doMock('../lambda/ingestion/time', () => ({
    getDateWithLookback: mockGetDateWithLookback,
  }));

  // `require` avoids NodeNext explicit extension warnings in test type-checking.
  const module = require('../lambda/ingestion/ingestionLogic') as {
    getLatestMarketDateResults: (rest: unknown) => Promise<{ date: string; results: unknown[] }>;
    backfillHistory: (rest: unknown, tableName: string) => Promise<string[]>;
  };

  return {
    module,
    mockFetchTickerForDate,
    mockStoreResultsForDate,
    mockGetDateWithLookback,
  };
};

describe('ingestion logic', () => {
  test('getLatestMarketDateResults picks the most recent complete date', async () => {
    const { module, mockFetchTickerForDate, mockGetDateWithLookback } =
      await loadIngestionLogicWithMocks();

    mockGetDateWithLookback.mockImplementation((lookback: number) =>
      lookback === 0 ? '2026-03-10' : '2026-03-09'
    );

    mockFetchTickerForDate.mockImplementation(
      async (_rest: unknown, ticker: string, date: string) => {
        if (date === '2026-03-10') {
          return ticker === 'AAPL'
            ? { symbol: 'AAPL', open: 100, close: 101, percentChange: 1 }
            : null;
        }

        return ticker === 'AAPL'
          ? { symbol: 'AAPL', open: 100, close: 102, percentChange: 2 }
          : { symbol: 'MSFT', open: 100, close: 95, percentChange: -5 };
      }
    );

    const result = await module.getLatestMarketDateResults({} as never);

    expect(result.date).toBe('2026-03-09');
    expect(result.results).toHaveLength(2);
  });

  test('getLatestMarketDateResults throws when no complete date exists', async () => {
    const { module, mockFetchTickerForDate } = await loadIngestionLogicWithMocks();
    mockFetchTickerForDate.mockResolvedValue(null);

    await expect(module.getLatestMarketDateResults({} as never)).rejects.toThrow(
      'No valid market data found in lookback window.'
    );
  });

  test('backfillHistory stores only complete dates and returns newest first', async () => {
    const { module, mockFetchTickerForDate, mockStoreResultsForDate, mockGetDateWithLookback } =
      await loadIngestionLogicWithMocks();

    mockGetDateWithLookback.mockImplementation((lookback: number) => {
      const map = ['2026-03-10', '2026-03-09', '2026-03-08', '2026-03-07', '2026-03-06', '2026-03-05'];
      return map[lookback];
    });

    mockFetchTickerForDate.mockImplementation(
      async (_rest: unknown, ticker: string, date: string) => {
        const data: Record<string, Record<string, { open: number; close: number; percentChange: number }>> = {
          AAPL: {
            '2026-03-10': { open: 100, close: 101, percentChange: 1 },
            '2026-03-09': { open: 100, close: 102, percentChange: 2 },
          },
          MSFT: {
            '2026-03-10': { open: 100, close: 99, percentChange: -1 },
            '2026-03-09': { open: 100, close: 103, percentChange: 3 },
          },
        };

        const tickerData = data[ticker]?.[date];
        if (!tickerData) {
          return null;
        }

        return {
          symbol: ticker,
          open: tickerData.open,
          close: tickerData.close,
          percentChange: tickerData.percentChange,
        };
      }
    );

    const completeDates = await module.backfillHistory({} as never, 'DailyWinners');

    expect(completeDates).toEqual(['2026-03-10', '2026-03-09']);
    expect(mockStoreResultsForDate).toHaveBeenCalledTimes(2);
    expect(mockStoreResultsForDate).toHaveBeenNthCalledWith(
      1,
      'DailyWinners',
      '2026-03-10',
      expect.any(Array)
    );
    expect(mockStoreResultsForDate).toHaveBeenNthCalledWith(
      2,
      'DailyWinners',
      '2026-03-09',
      expect.any(Array)
    );
  });

  test('backfillHistory throws when unable to build required number of complete days', async () => {
    const { module, mockFetchTickerForDate } = await loadIngestionLogicWithMocks();

    mockFetchTickerForDate.mockImplementation(
      async (_rest: unknown, ticker: string, date: string) => {
        if (ticker === 'AAPL' && (date === '2026-03-10' || date === '2026-03-09')) {
          return { symbol: ticker, open: 100, close: 101, percentChange: 1 };
        }
        if (ticker === 'MSFT' && date === '2026-03-10') {
          return { symbol: ticker, open: 100, close: 99, percentChange: -1 };
        }
        return null;
      }
    );

    await expect(module.backfillHistory({} as never, 'DailyWinners')).rejects.toThrow(
      'Unable to gather 7 complete historical market days.'
    );
  });
});
