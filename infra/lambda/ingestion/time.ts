import { MARKET_TIMEZONE } from './config';

/**
 * Format a Date into `YYYY-MM-DD` in the given IANA timezone.
 */
export const formatDateForTimezone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to format date in target timezone.');
  }

  return `${year}-${month}-${day}`;
};

/**
 * Get a date string in market timezone for N days ago.
 */
export const getDateWithLookback = (daysAgo: number): string => {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return formatDateForTimezone(date, MARKET_TIMEZONE);
};

/**
 * Parse an ISO date string (`YYYY-MM-DD`) into a UTC date.
 */
export const parseIsoDateToUtc = (isoDate: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Reject impossible dates like 2026-02-30.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${isoDate}`);
  }

  return parsed;
};

/**
 * Add months to a UTC date while clamping to the end of target month.
 */
export const addMonthsClampedUtc = (date: Date, months: number): Date => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthLastDay = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, targetMonthLastDay);

  return new Date(Date.UTC(year, month + months, targetDay));
};

/**
 * Convert `recordDate + months` to epoch seconds for DynamoDB TTL.
 */
export const getEpochSecondsForDatePlusMonths = (recordDate: string, months: number): number => {
  const baseDate = parseIsoDateToUtc(recordDate);
  const expiryDate = addMonthsClampedUtc(baseDate, months);
  return Math.floor(expiryDate.getTime() / 1000);
};
