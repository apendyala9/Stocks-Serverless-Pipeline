type LoadedDynamoModule = typeof import('../lambda/ingestion/dynamo');

const loadDynamoModuleWithMocks = async () => {
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
    ScanCommand: class {
      input: unknown;

      constructor(input: unknown) {
        this.input = input;
      }
    },
    PutCommand: class {
      input: unknown;

      constructor(input: unknown) {
        this.input = input;
      }
    },
  }));

  // `require` avoids NodeNext explicit extension warnings in test type-checking.
  const module = require('../lambda/ingestion/dynamo') as LoadedDynamoModule;
  return { module, mockSend };
};

describe('dynamo module', () => {
  test('tableHasAnyData returns true when at least one row exists', async () => {
    const { module, mockSend } = await loadDynamoModuleWithMocks();
    mockSend.mockResolvedValue({ Items: [{ date: '2026-03-06' }] });

    await expect(module.tableHasAnyData('DailyWinners')).resolves.toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: 'DailyWinners',
      Limit: 1,
      ProjectionExpression: '#date',
    });
  });

  test('tableHasAnyData returns false when table is empty', async () => {
    const { module, mockSend } = await loadDynamoModuleWithMocks();
    mockSend.mockResolvedValue({ Items: [] });

    await expect(module.tableHasAnyData('DailyWinners')).resolves.toBe(false);
  });

  test('getWinnerSymbol uses absolute percent change', async () => {
    const { module } = await loadDynamoModuleWithMocks();

    const winner = module.getWinnerSymbol([
      { symbol: 'AAPL', open: 100, close: 102, percentChange: 2 },
      { symbol: 'MSFT', open: 100, close: 85, percentChange: -15 },
      { symbol: 'TSLA', open: 100, close: 108, percentChange: 8 },
    ]);

    expect(winner).toBe('MSFT');
  });

  test('storeResultsForDate writes all results and winner flag', async () => {
    const { module, mockSend } = await loadDynamoModuleWithMocks();
    mockSend.mockResolvedValue({});

    await module.storeResultsForDate('DailyWinners', '2026-03-06', [
      { symbol: 'AAPL', open: 100, close: 110, percentChange: 10.123456 },
      { symbol: 'MSFT', open: 100, close: 90, percentChange: -10.987654 },
    ]);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const putInputs = mockSend.mock.calls.map((call) => call[0].input);
    const expectedExpiresAt =
      Math.floor(new Date('2026-03-06').getTime() / 1000) + 7 * 24 * 60 * 60;

    expect(putInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          TableName: 'DailyWinners',
          Item: expect.objectContaining({
            date: '2026-03-06',
            tickerSymbol: 'AAPL',
            percentChange: 10.1235,
            closingPrice: 110,
            isWinner: false,
            expiresAt: expectedExpiresAt,
          }),
          ConditionExpression: 'attribute_not_exists(#date) AND attribute_not_exists(#ticker)',
        }),
        expect.objectContaining({
          TableName: 'DailyWinners',
          Item: expect.objectContaining({
            date: '2026-03-06',
            tickerSymbol: 'MSFT',
            percentChange: -10.9877,
            closingPrice: 90,
            isWinner: true,
            expiresAt: expectedExpiresAt,
          }),
          ConditionExpression: 'attribute_not_exists(#date) AND attribute_not_exists(#ticker)',
        }),
      ])
    );
  });

  test('storeResultsForDate ignores ConditionalCheckFailedException', async () => {
    const { module, mockSend } = await loadDynamoModuleWithMocks();
    mockSend
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
      .mockResolvedValueOnce({});

    await expect(
      module.storeResultsForDate('DailyWinners', '2026-03-06', [
        { symbol: 'AAPL', open: 100, close: 110, percentChange: 10 },
        { symbol: 'MSFT', open: 100, close: 95, percentChange: -5 },
      ])
    ).resolves.toBeUndefined();
  });

  test('storeResultsForDate rethrows non-conditional errors', async () => {
    const { module, mockSend } = await loadDynamoModuleWithMocks();
    mockSend.mockRejectedValueOnce(new Error('dynamo down'));

    await expect(
      module.storeResultsForDate('DailyWinners', '2026-03-06', [
        { symbol: 'AAPL', open: 100, close: 110, percentChange: 10 },
      ])
    ).rejects.toThrow('dynamo down');
  });
});
