import { Box, Paper, Stack, Typography } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import type { HistoryDay } from '../types'

type DailyBarsViewProps = {
  history: HistoryDay[]
}

export const DailyBarsView = ({ history }: DailyBarsViewProps) => {
  const sortedDays = [...history].sort((left, right) => right.date.localeCompare(left.date))

  return (
    <Stack spacing={2}>
      {sortedDays.map((day) => {
        const sortedMovers = [...day.movers].sort((left, right) =>
          left.tickerSymbol.localeCompare(right.tickerSymbol)
        )

        return (
          <Paper key={day.date} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {day.date}
            </Typography>
            <Box sx={{ width: '100%', overflowX: 'auto' }}>
              <BarChart
                height={280}
                xAxis={[{ scaleType: 'band', data: sortedMovers.map((mover) => mover.tickerSymbol) }]}
                series={[
                  {
                    label: '% Change',
                    data: sortedMovers.map((mover) => mover.percentChange),
                  },
                ]}
                margin={{ left: 60, right: 20, top: 20, bottom: 40 }}
              />
            </Box>
          </Paper>
        )
      })}
    </Stack>
  )
}
