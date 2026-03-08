type LoadedApiModule = typeof import('../lambda/api/index');

const loadApiHandlerWithMocks = async () => {
  jest.resetModules();

  const mockFetchRecentWinners = jest.fn();
  const mockFetchRecentHistory = jest.fn();
  jest.doMock('../lambda/api/moversService', () => ({
    fetchRecentWinners: mockFetchRecentWinners,
    fetchRecentHistory: mockFetchRecentHistory,
  }));

  // `require` avoids NodeNext explicit extension warnings in test type-checking.
  const module = require('../lambda/api/index') as LoadedApiModule;
  return { module, mockFetchRecentWinners, mockFetchRecentHistory };
};

describe('api movers handler', () => {
  test('returns 500 when WINNERS_TABLE_NAME is missing', async () => {
    delete process.env.WINNERS_TABLE_NAME;
    const { module, mockFetchRecentWinners } = await loadApiHandlerWithMocks();

    const response = await module.handler({} as never);
    const body = JSON.parse(response.body) as { message: string };

    expect(response.statusCode).toBe(500);
    expect(body.message).toBe('Failed to retrieve movers.');
    expect(mockFetchRecentWinners).not.toHaveBeenCalled();
  });

  test('returns movers payload when fetch succeeds', async () => {
    process.env.WINNERS_TABLE_NAME = 'DailyWinners';
    const { module, mockFetchRecentWinners, mockFetchRecentHistory } = await loadApiHandlerWithMocks();
    mockFetchRecentWinners.mockResolvedValue([
      {
        date: '2026-03-06',
        tickerSymbol: 'AAPL',
        percentChange: 4.2,
        closingPrice: 208.11,
      },
    ]);

    const response = await module.handler({ path: '/movers' } as never);
    const body = JSON.parse(response.body) as {
      data: Array<{ date: string; tickerSymbol: string }>;
    };

    expect(response.statusCode).toBe(200);
    expect(mockFetchRecentWinners).toHaveBeenCalledWith('DailyWinners');
    expect(mockFetchRecentHistory).not.toHaveBeenCalled();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tickerSymbol).toBe('AAPL');
  });

  test('returns history payload when /history is requested', async () => {
    process.env.WINNERS_TABLE_NAME = 'DailyWinners';
    const { module, mockFetchRecentWinners, mockFetchRecentHistory } = await loadApiHandlerWithMocks();
    mockFetchRecentHistory.mockResolvedValue([
      {
        date: '2026-03-06',
        movers: [
          {
            date: '2026-03-06',
            tickerSymbol: 'AAPL',
            percentChange: 4.2,
            closingPrice: 208.11,
            isWinner: true,
          },
        ],
      },
    ]);

    const response = await module.handler({ path: '/history' } as never);
    const body = JSON.parse(response.body) as {
      data: Array<{ date: string; movers: Array<{ tickerSymbol: string }> }>;
    };

    expect(response.statusCode).toBe(200);
    expect(mockFetchRecentHistory).toHaveBeenCalledWith('DailyWinners');
    expect(mockFetchRecentWinners).not.toHaveBeenCalled();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].movers[0].tickerSymbol).toBe('AAPL');
  });

  test('returns 500 when fetchRecentWinners throws', async () => {
    process.env.WINNERS_TABLE_NAME = 'DailyWinners';
    const { module, mockFetchRecentWinners } = await loadApiHandlerWithMocks();
    mockFetchRecentWinners.mockRejectedValue(new Error('boom'));

    const response = await module.handler({} as never);
    const body = JSON.parse(response.body) as { message: string };

    expect(response.statusCode).toBe(500);
    expect(body.message).toBe('Failed to retrieve movers.');
  });
});
