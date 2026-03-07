type TestSetup = {
  handler: (event: unknown) => Promise<{ statusCode: number; body: string }>;
  mockSend: jest.Mock;
  mockRestClient: jest.Mock;
  mockTableHasAnyData: jest.Mock;
  mockStoreResultsForDate: jest.Mock;
  mockGetWinnerSymbol: jest.Mock;
  mockBackfillHistory: jest.Mock;
  mockGetLatestMarketDateResults: jest.Mock;
};

const loadHandlerWithMocks = async (env: {
  MASSIVE_API_SECRET_ARN?: string;
  WINNERS_TABLE_NAME?: string;
}): Promise<TestSetup> => {
  jest.resetModules();

  if (env.MASSIVE_API_SECRET_ARN === undefined) {
    delete process.env.MASSIVE_API_SECRET_ARN;
  } else {
    process.env.MASSIVE_API_SECRET_ARN = env.MASSIVE_API_SECRET_ARN;
  }

  if (env.WINNERS_TABLE_NAME === undefined) {
    delete process.env.WINNERS_TABLE_NAME;
  } else {
    process.env.WINNERS_TABLE_NAME = env.WINNERS_TABLE_NAME;
  }

  const mockSend = jest.fn();
  const mockRestClient = jest.fn(() => ({ fakeRestClient: true }));
  const mockTableHasAnyData = jest.fn();
  const mockStoreResultsForDate = jest.fn();
  const mockGetWinnerSymbol = jest.fn();
  const mockBackfillHistory = jest.fn();
  const mockGetLatestMarketDateResults = jest.fn();

  jest.doMock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input: unknown) => input),
  }));

  jest.doMock(
    '@massive.com/client-js',
    () => ({
      restClient: mockRestClient,
    }),
    { virtual: true }
  );

  jest.doMock('../lambda/ingestion/dynamo', () => ({
    tableHasAnyData: mockTableHasAnyData,
    storeResultsForDate: mockStoreResultsForDate,
    getWinnerSymbol: mockGetWinnerSymbol,
  }));

  jest.doMock('../lambda/ingestion/ingestionLogic', () => ({
    backfillHistory: mockBackfillHistory,
    getLatestMarketDateResults: mockGetLatestMarketDateResults,
  }));

  // `require` avoids NodeNext explicit extension warnings in test type-checking.
  const module = require('../lambda/ingestion/index') as {
    handler: (event: unknown) => Promise<{ statusCode: number; body: string }>;
  };

  return {
    handler: module.handler as unknown as (event: unknown) => Promise<{ statusCode: number; body: string }>,
    mockSend,
    mockRestClient,
    mockTableHasAnyData,
    mockStoreResultsForDate,
    mockGetWinnerSymbol,
    mockBackfillHistory,
    mockGetLatestMarketDateResults,
  };
};

describe('ingestion handler', () => {
  test('returns 500 when MASSIVE_API_SECRET_ARN is missing', async () => {
    const { handler, mockSend } = await loadHandlerWithMocks({
      WINNERS_TABLE_NAME: 'DailyWinners',
    });

    const response = await handler({} as never);
    const body = JSON.parse(response.body) as { message: string };

    expect(response.statusCode).toBe(500);
    expect(body.message).toBe('Ingestion failed.');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns 500 when WINNERS_TABLE_NAME is missing', async () => {
    const { handler, mockSend } = await loadHandlerWithMocks({
      MASSIVE_API_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:key',
    });
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ MASSIVE_API_KEY: 'test-api-key' }),
    });

    const response = await handler({} as never);
    const body = JSON.parse(response.body) as { message: string };

    expect(response.statusCode).toBe(500);
    expect(body.message).toBe('Ingestion failed.');
  });

  test('backfills history when table has no data', async () => {
    const {
      handler,
      mockSend,
      mockRestClient,
      mockTableHasAnyData,
      mockBackfillHistory,
      mockStoreResultsForDate,
    } = await loadHandlerWithMocks({
      MASSIVE_API_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:key',
      WINNERS_TABLE_NAME: 'DailyWinners',
    });
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ MASSIVE_API_KEY: 'test-api-key' }),
    });
    mockTableHasAnyData.mockResolvedValue(false);
    mockBackfillHistory.mockResolvedValue(['2026-03-05', '2026-03-04']);

    const response = await handler({} as never);
    const body = JSON.parse(response.body) as {
      message: string;
      backfilledDates: string[];
      rowsPerDate: number;
    };

    expect(response.statusCode).toBe(200);
    expect(mockRestClient).toHaveBeenCalledWith('test-api-key', 'https://api.massive.com');
    expect(mockTableHasAnyData).toHaveBeenCalledWith('DailyWinners');
    expect(mockBackfillHistory).toHaveBeenCalledWith({ fakeRestClient: true }, 'DailyWinners');
    expect(mockStoreResultsForDate).not.toHaveBeenCalled();
    expect(body.message).toBe('Backfilled historical stock rows.');
    expect(body.backfilledDates).toEqual(['2026-03-05', '2026-03-04']);
  });

  test('stores latest market day when table already has data', async () => {
    const {
      handler,
      mockSend,
      mockTableHasAnyData,
      mockGetLatestMarketDateResults,
      mockStoreResultsForDate,
      mockGetWinnerSymbol,
    } = await loadHandlerWithMocks({
      MASSIVE_API_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:key',
      WINNERS_TABLE_NAME: 'DailyWinners',
    });
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ MASSIVE_API_KEY: 'test-api-key' }),
    });
    mockTableHasAnyData.mockResolvedValue(true);
    mockGetLatestMarketDateResults.mockResolvedValue({
      date: '2026-03-06',
      results: [
        { symbol: 'AAPL', open: 100, close: 110, percentChange: 10 },
        { symbol: 'MSFT', open: 100, close: 90, percentChange: -10 },
      ],
    });
    mockGetWinnerSymbol.mockReturnValue('AAPL');

    const response = await handler({} as never);
    const body = JSON.parse(response.body) as {
      message: string;
      date: string;
      winnerTickerSymbol: string;
      rowCount: number;
    };

    expect(response.statusCode).toBe(200);
    expect(mockStoreResultsForDate).toHaveBeenCalledWith(
      'DailyWinners',
      '2026-03-06',
      expect.any(Array)
    );
    expect(body.message).toBe('Daily stock rows stored.');
    expect(body.date).toBe('2026-03-06');
    expect(body.winnerTickerSymbol).toBe('AAPL');
  });

  test('caches secret value between handler invocations in same module instance', async () => {
    const {
      handler,
      mockSend,
      mockTableHasAnyData,
      mockGetLatestMarketDateResults,
      mockStoreResultsForDate,
      mockGetWinnerSymbol,
    } = await loadHandlerWithMocks({
      MASSIVE_API_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:key',
      WINNERS_TABLE_NAME: 'DailyWinners',
    });
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ MASSIVE_API_KEY: 'cached-key' }),
    });
    mockTableHasAnyData.mockResolvedValue(true);
    mockGetLatestMarketDateResults.mockResolvedValue({
      date: '2026-03-06',
      results: [
        { symbol: 'AAPL', open: 100, close: 110, percentChange: 10 },
        { symbol: 'MSFT', open: 100, close: 90, percentChange: -10 },
      ],
    });
    mockStoreResultsForDate.mockResolvedValue(undefined);
    mockGetWinnerSymbol.mockReturnValue('AAPL');

    const firstResponse = await handler({} as never);
    const secondResponse = await handler({} as never);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
