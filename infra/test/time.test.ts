import {
  formatDateForTimezone,
  getDateWithLookback,
  getEpochSecondsForDatePlusMonths,
  parseIsoDateToUtc,
} from '../lambda/ingestion/time';

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

  test('computes ttl epoch by adding calendar months from record date', () => {
    const expiresAt = getEpochSecondsForDatePlusMonths('2026-03-02', 1);
    const expected = Math.floor(new Date(Date.UTC(2026, 3, 2)).getTime() / 1000);
    expect(expiresAt).toBe(expected);
  });

  test('clamps end-of-month when adding months', () => {
    const expiresAt = getEpochSecondsForDatePlusMonths('2026-01-31', 1);
    const expected = Math.floor(new Date(Date.UTC(2026, 1, 28)).getTime() / 1000);
    expect(expiresAt).toBe(expected);
  });

  test('rejects invalid iso dates', () => {
    expect(() => parseIsoDateToUtc('2026-02-30')).toThrow('Invalid calendar date: 2026-02-30');
  });
});
