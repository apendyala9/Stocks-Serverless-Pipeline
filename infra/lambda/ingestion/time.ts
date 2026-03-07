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
