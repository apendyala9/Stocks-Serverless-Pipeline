import './App.css'
import { useEffect, useState } from 'react'

type Mover = {
  date: string
  tickerSymbol: string
  percentChange: number
  closingPrice: number
}

type MoversApiResponse = {
  data: Mover[]
}

function App() {
  const [movers, setMovers] = useState<Mover[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const loadMovers = async () => {
      try {
        setLoading(true)
        const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''
        const response = await fetch(`${apiBase}/movers`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const payload = (await response.json()) as MoversApiResponse
        setMovers(payload.data ?? [])
        console.log('movers', payload.data)
      } catch (requestError) {
        if (!controller.signal.aborted) {
          console.error('Failed to load movers', requestError)
          setError('Failed to load movers.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadMovers()
    return () => controller.abort()
  }, [])

  const formatPercentChange = (value: number): string => `${value.toFixed(2)}%`
  const formatClosingPrice = (value: number): string => `$${value.toFixed(2)}`

  return (
    <main className="app-container">
      <div className="panel">
        <h1>Top Mover History</h1>
        <p className="subtitle">Last 7 market days from DynamoDB</p>

        {loading && (
          <p role="status" className="status-message">
            Loading winning stocks...
          </p>
        )}

        {!loading && error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}

        {!loading && !error && (
          <table className="movers-table" aria-label="Top mover history">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Percent Change</th>
                <th>Close</th>
              </tr>
            </thead>
            <tbody>
              {movers.map((mover) => (
                <tr key={`${mover.date}-${mover.tickerSymbol}`}>
                  <td>{mover.date}</td>
                  <td>{mover.tickerSymbol}</td>
                  <td className={mover.percentChange >= 0 ? 'gain' : 'loss'}>
                    {formatPercentChange(mover.percentChange)}
                  </td>
                  <td>{formatClosingPrice(mover.closingPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}

export default App
