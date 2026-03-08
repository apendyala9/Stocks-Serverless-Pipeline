import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { Mover } from '../types'

type WinnersViewProps = {
  movers: Mover[]
}

const formatPercentChange = (value: number): string => `${value.toFixed(2)}%`
const formatClosingPrice = (value: number): string => `$${value.toFixed(2)}`

export const WinnersView = ({ movers }: WinnersViewProps) => (
  <TableContainer component={Paper} variant="outlined">
    <Table aria-label="Top mover history" size="small">
      <TableHead>
        <TableRow>
          <TableCell>Date</TableCell>
          <TableCell>Ticker</TableCell>
          <TableCell align="right">Percent Change</TableCell>
          <TableCell align="right">Close</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {movers.map((mover) => (
          <TableRow key={`${mover.date}-${mover.tickerSymbol}`}>
            <TableCell>{mover.date}</TableCell>
            <TableCell>{mover.tickerSymbol}</TableCell>
            <TableCell
              align="right"
              sx={{
                color: mover.percentChange >= 0 ? 'success.main' : 'error.main',
                fontWeight: 700,
              }}
            >
              {formatPercentChange(mover.percentChange)}
            </TableCell>
            <TableCell align="right">{formatClosingPrice(mover.closingPrice)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    {movers.length === 0 && (
      <Typography sx={{ p: 2 }} color="text.secondary">
        No winner data available.
      </Typography>
    )}
  </TableContainer>
)
