import type { restClient } from '@massive.com/client-js';

export type OpenCloseData = {
  status?: string;
  symbol?: string;
  open?: number;
  close?: number;
};

export type TickerResult = {
  symbol: string;
  open: number;
  close: number;
  percentChange: number;
};

export type DatedTickerResult = TickerResult & {
  date: string;
};

export type MassiveRestClient = ReturnType<typeof restClient>;

export type HttpErrorWithResponse = {
  name?: string;
  message?: string;
  code?: string;
  response?: {
    status?: number;
    headers?: Record<string, string | number | undefined>;
    data?: {
      request_id?: string;
      message?: string;
      status?: string;
    };
  };
};
