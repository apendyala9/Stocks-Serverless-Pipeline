type LoadedMoversServiceModule = typeof import('../lambda/api/moversService');

const loadMoversServiceWithMocks = async () => {
  jest.resetModules();

  const mockSend = jest.fn();
  const mockFrom = jest.fn(() => ({ send: mockSend }));

  jest.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(),
  }));

  jest.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
      from: mockFrom,
    },
    QueryCommand: class {
      input: unknown;

      constructor(input: unknown) {
        this.input = input;
      }
    },
  }));

  // `require` avoids NodeNext explicit extension warnings in test type-checking.
  const module = require('../lambda/api/moversService') as LoadedMoversServiceModule;
  return { module, mockSend };
};

describe('movers service', () => {
  test('fetchRecentWinners queries winners GSI once and returns latest winners', async () => {
    const { module, mockSend } = await loadMoversServiceWithMocks();
    mockSend.mockResolvedValue({
      Items: [
        {
          date: '2026-03-10',
          tickerSymbol: 'AAPL',
          percentChange: 5.2,
          closingPrice: 201.11,
        },
        {
          date: '2026-03-09',
          tickerSymbol: 'MSFT',
          percentChange: -2.1,
          closingPrice: 312.5,
        },
      ],
    });

    const winners = await module.fetchRecentWinners('DailyWinners');

    expect(winners).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: 'DailyWinners',
      IndexName: 'WinnersByDateIndex',
      KeyConditionExpression: '#gsi2pk = :pkValue',
      ExpressionAttributeValues: {
        ':pkValue': 'WINNERS',
      },
      ScanIndexForward: false,
      Limit: 7,
    });
  });

  test('fetchRecentHistory queries history GSI once and keeps only complete days', async () => {
    const { module, mockSend } = await loadMoversServiceWithMocks();
    mockSend.mockResolvedValue({
      Items: [
        { date: '2026-03-10', tickerSymbol: 'MSFT', percentChange: -2.4, closingPrice: 123.45, isWinner: false },
        { date: '2026-03-10', tickerSymbol: 'AAPL', percentChange: 2.4, closingPrice: 180.12, isWinner: true },
        { date: '2026-03-10', tickerSymbol: 'GOOGL', percentChange: 0.2, closingPrice: 150.12, isWinner: false },
        { date: '2026-03-10', tickerSymbol: 'AMZN', percentChange: 1.1, closingPrice: 190.33, isWinner: false },
        { date: '2026-03-10', tickerSymbol: 'TSLA', percentChange: -1.5, closingPrice: 175.2, isWinner: false },
        { date: '2026-03-10', tickerSymbol: 'NVDA', percentChange: 0.9, closingPrice: 899.77, isWinner: false },
        // Incomplete day should be skipped.
        { date: '2026-03-09', tickerSymbol: 'MSFT', percentChange: -0.4, closingPrice: 121.45, isWinner: false },
        { date: '2026-03-08', tickerSymbol: 'MSFT', percentChange: -5.4, closingPrice: 124.55, isWinner: false },
        { date: '2026-03-08', tickerSymbol: 'TSLA', percentChange: 8.9, closingPrice: 177.77, isWinner: true },
        { date: '2026-03-08', tickerSymbol: 'AAPL', percentChange: 2.1, closingPrice: 207.7, isWinner: false },
        { date: '2026-03-08', tickerSymbol: 'GOOGL', percentChange: 1.4, closingPrice: 151.2, isWinner: false },
        { date: '2026-03-08', tickerSymbol: 'AMZN', percentChange: -3.2, closingPrice: 186.4, isWinner: false },
        { date: '2026-03-08', tickerSymbol: 'NVDA', percentChange: 0.5, closingPrice: 901.1, isWinner: false },
      ],
    });

    const history = await module.fetchRecentHistory('DailyWinners');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: 'DailyWinners',
      IndexName: 'HistoryByDateIndex',
      KeyConditionExpression: '#gsi1pk = :pkValue',
      ExpressionAttributeValues: {
        ':pkValue': 'HISTORY',
      },
      ScanIndexForward: false,
    });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      date: '2026-03-10',
    });
    expect(history[0].movers.map((mover) => mover.tickerSymbol)).toEqual([
      'AAPL',
      'AMZN',
      'GOOGL',
      'MSFT',
      'NVDA',
      'TSLA',
    ]);
    expect(history[1]).toMatchObject({
      date: '2026-03-08',
    });
  });
});
