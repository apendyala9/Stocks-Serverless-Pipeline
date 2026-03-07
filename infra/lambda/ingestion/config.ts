export const WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'] as const;
export const MARKET_TIMEZONE = 'America/New_York';
export const MAX_LOOKBACK_DAYS = 14;
export const HISTORY_DAYS = 7;
export const MAX_HISTORY_LOOKBACK_DAYS = 30;
export const TTL_MONTHS = 1;

// Massive.com free-tier throttle.
export const MASSIVE_REQUESTS_PER_MINUTE = 5;
export const MASSIVE_REQUEST_INTERVAL_MS = Math.ceil(60_000 / MASSIVE_REQUESTS_PER_MINUTE);
export const MAX_429_RETRIES = 4;
export const MAX_RETRY_DELAY_MS = 60_000;
