import { LineChart } from '@mui/x-charts/LineChart'
import { Paper, Typography } from '@mui/material'
import type { HistoryDay } from '../types'

type TrendsViewProps = {
  history: HistoryDay[]
}

export const TrendsView = ({ history }: TrendsViewProps) => {
  const sortedDays = [...history].sort((left, right) => left.date.localeCompare(right.date))
  const dates = sortedDays.map((day) => day.date)

  const tickerSet = new Set<string>()
  for (const day of sortedDays) {
    for (const mover of day.movers) {
      tickerSet.add(mover.tickerSymbol)
    }
  }
  const tickers = [...tickerSet].sort((left, right) => left.localeCompare(right))

  const series = tickers.map((tickerSymbol) => ({
    label: tickerSymbol,
    data: sortedDays.map((day) => {
      const match = day.movers.find((mover) => mover.tickerSymbol === tickerSymbol)
      return match?.percentChange ?? null
    }),
  }))

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        Percent Change by Ticker (Last 7 Days)
      </Typography>
      <LineChart
        height={360}
        xAxis={[{ scaleType: 'point', data: dates }]}
        series={series}
        margin={{ left: 60, right: 20, top: 20, bottom: 40 }}
      />
    </Paper>
  )
}
