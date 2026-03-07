import { formatDateForTimezone, getDateWithLookback } from '../lambda/ingestion/time';

describe('time utilities', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('formats date as YYYY-MM-DD for a timezone', () => {
    const result = formatDateForTimezone(new Date('2026-03-06T15:30:00.000Z'), 'America/New_York');
    expect(result).toBe('2026-03-06');
  });

  test('returns market date with lookback based on current time', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-06T15:30:00.000Z').getTime());

    expect(getDateWithLookback(0)).toBe('2026-03-06');
    expect(getDateWithLookback(1)).toBe('2026-03-05');
  });
});
