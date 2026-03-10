import { useEffect, useState } from 'react'
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded'
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import {
  Alert,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import type { HistoryApiResponse, HistoryDay, MoversApiResponse, Mover } from './types'
import { DailyBarsView } from './views/DailyBarsView'
import { TrendsView } from './views/TrendsView'
import { WinnersView } from './views/WinnersView'

type DashboardView = 'winners' | 'trend' | 'bars'

function App() {
  const [movers, setMovers] = useState<Mover[]>([])
  const [history, setHistory] = useState<HistoryDay[]>([])
  const [selectedView, setSelectedView] = useState<DashboardView>('winners')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const loadData = async () => {
      try {
        setLoading(true)
        const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''
        const [moversResponse, historyResponse] = await Promise.all([
          fetch(`${apiBase}/movers`, { signal: controller.signal }),
          fetch(`${apiBase}/history`, { signal: controller.signal }),
        ])

        if (!moversResponse.ok) {
          throw new Error(`Request failed with status ${moversResponse.status} for /movers`)
        }
        if (!historyResponse.ok) {
          throw new Error(`Request failed with status ${historyResponse.status} for /history`)
        }

        const moversPayload = (await moversResponse.json()) as MoversApiResponse
        const historyPayload = (await historyResponse.json()) as HistoryApiResponse
        console.log('moversPayload', moversPayload)
        console.log('historyPayload', historyPayload)
        setMovers(moversPayload.data ?? [])
        setHistory(historyPayload.data ?? [])
      } catch (requestError) {
        if (!controller.signal.aborted) {
          console.error('Failed to load dashboard data', requestError)
          setError('Failed to load dashboard data.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadData()
    return () => controller.abort()
  }, [])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 10, pt: 3 }}>
      <Container maxWidth="lg">
        <Paper elevation={3} sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h4">Stock Movers Dashboard</Typography>
              <Typography variant="body2" color="text.secondary">
                Last 7 market days of stock data
              </Typography>
            </Box>

            {loading && (
              <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={20} />
                <Typography>Loading stock dashboard...</Typography>
              </Box>
            )}

            {!loading && error && (
              <Alert role="alert" severity="error">
                {error}
              </Alert>
            )}

            {!loading && !error && selectedView === 'winners' && <WinnersView movers={movers} />}
            {!loading && !error && selectedView === 'trend' && <TrendsView history={history} />}
            {!loading && !error && selectedView === 'bars' && <DailyBarsView history={history} />}
          </Stack>
        </Paper>
      </Container>

      <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0 }} elevation={8}>
        <BottomNavigation
          showLabels
          value={selectedView}
          onChange={(_event, value: DashboardView) => setSelectedView(value)}
        >
          <BottomNavigationAction
            label="Winners"
            value="winners"
            icon={<EmojiEventsOutlinedIcon />}
          />
          <BottomNavigationAction label="Trend" value="trend" icon={<ShowChartIcon />} />
          <BottomNavigationAction label="Daily Bars" value="bars" icon={<BarChartRoundedIcon />} />
        </BottomNavigation>
      </Paper>
    </Box>
  )
}

export default App
