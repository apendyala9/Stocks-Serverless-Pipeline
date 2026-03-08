import { render, screen, waitFor } from '@testing-library/react'
import App from './App'

describe('App', () => {
  test('shows loading state, then renders movers from API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            date: '2026-03-06',
            tickerSymbol: 'AAPL',
            percentChange: 4.23,
            closingPrice: 201.11,
          },
          {
            date: '2026-03-05',
            tickerSymbol: 'TSLA',
            percentChange: -3.44,
            closingPrice: 178.6,
          },
        ],
      }),
    } as Response)

    render(<App />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading winning stocks...')
    expect(await screen.findByRole('table', { name: 'Top mover history' })).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument()
    expect(screen.getByText('4.23%')).toHaveClass('gain')
    expect(screen.getByText('-3.44%')).toHaveClass('loss')

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    fetchSpy.mockRestore()
  })

  test('shows error message when request fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network issue'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load movers.')

    fetchSpy.mockRestore()
  })
})
