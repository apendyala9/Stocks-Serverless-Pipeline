type LoadedMoversServiceModule = typeof import('../lambda/api/moversService');

const loadMoversServiceWithMocks = async (dates: string[]) => {
  jest.resetModules();

  const mockSend = jest.fn();
  const mockFrom = jest.fn(() => ({ send: mockSend }));
  const mockGetDateWithLookback = jest.fn((lookback: number) => dates[lookback] ?? '2099-01-01');

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

  jest.doMock('../lambda/ingestion/time', () => ({
    getDateWithLookback: mockGetDateWithLookback,
  }));

  // `require` avoids NodeNext explicit extension warnings in test type-checking.
  const module = require('../lambda/api/moversService') as LoadedMoversServiceModule;
  return { module, mockSend };
};

describe('movers service', () => {
  test('returns 7 winners and stops querying when enough records are found', async () => {
    const dates = Array.from({ length: 31 }, (_, index) => `2026-03-${String(31 - index).padStart(2, '0')}`);
    const { module, mockSend } = await loadMoversServiceWithMocks(dates);

    for (let index = 0; index < 7; index += 1) {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            date: dates[index],
            tickerSymbol: 'AAPL',
            percentChange: 3 + index,
            closingPrice: 200 + index,
          },
        ],
      });
    }

    const winners = await module.fetchRecentWinners('DailyWinners');

    expect(winners).toHaveLength(7);
    expect(mockSend).toHaveBeenCalledTimes(7);
  });

  test('returns fewer winners when not enough trading days exist in lookback', async () => {
    const dates = Array.from({ length: 31 }, (_, index) => `2026-03-${String(31 - index).padStart(2, '0')}`);
    const { module, mockSend } = await loadMoversServiceWithMocks(dates);

    mockSend.mockResolvedValue({ Items: [] });
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          date: dates[0],
          tickerSymbol: 'MSFT',
          percentChange: -2.4,
          closingPrice: 123.45,
        },
      ],
    });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          date: dates[2],
          tickerSymbol: 'TSLA',
          percentChange: 8.9,
          closingPrice: 177.77,
        },
      ],
    });

    const winners = await module.fetchRecentWinners('DailyWinners');

    expect(winners).toHaveLength(2);
    expect(winners.map((winner) => winner.tickerSymbol)).toEqual(['MSFT', 'TSLA']);
    expect(mockSend).toHaveBeenCalledTimes(31);
  });
});
