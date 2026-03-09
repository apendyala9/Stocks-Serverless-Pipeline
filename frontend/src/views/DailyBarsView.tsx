import { Box, Paper, Stack, Typography, useTheme } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import type { HistoryDay } from '../types'
import { cardPaddingSx, chartContainerSx } from './viewStyles'

type DailyBarsViewProps = {
  history: HistoryDay[]
}

export const DailyBarsView = ({ history }: DailyBarsViewProps) => {
  const theme = useTheme()
  const sortedDays = [...history].sort((left, right) => right.date.localeCompare(left.date))

  return (
    <Stack spacing={2}>
      {sortedDays.map((day) => {
        const sortedMovers = [...day.movers].sort((left, right) =>
          left.tickerSymbol.localeCompare(right.tickerSymbol)
        )
        const xData = sortedMovers.map((m) => m.tickerSymbol)

        return (
          <Paper key={day.date} variant="outlined" sx={cardPaddingSx}>
            <Typography variant="subtitle1" gutterBottom>
              {day.date}
            </Typography>
            <Box sx={chartContainerSx}>
              <BarChart
                height={280}
                xAxis={[
                  {
                    scaleType: 'band',
                    data: xData,
                  },
                ]}
                yAxis={[
                  {
                    colorMap: {
                      type: 'piecewise',
                      thresholds: [0],
                      colors: [theme.palette.error.main, theme.palette.success.main],
                    },
                  },
                ]}
                series={[
                  {
                    label: '% Change',
                    data: sortedMovers.map((mover) => mover.percentChange),
                  },
                ]}
                margin={{ left: 60, right: 40, top: 20, bottom: 40 }}
              />
            </Box>
          </Paper>
        )
      })}
    </Stack>
  )
}
