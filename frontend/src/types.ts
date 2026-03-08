export type Mover = {
  date: string
  tickerSymbol: string
  percentChange: number
  closingPrice: number
}

export type HistoryMover = Mover & {
  isWinner: boolean
}

export type HistoryDay = {
  date: string
  movers: HistoryMover[]
}

export type MoversApiResponse = {
  data: Mover[]
}

export type HistoryApiResponse = {
  data: HistoryDay[]
}
