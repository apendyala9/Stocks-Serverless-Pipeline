import type { SxProps, Theme } from '@mui/material'

export const cardPaddingSx: SxProps<Theme> = { p: 2 }
export const emptyStateSx: SxProps<Theme> = { p: 2 }


export const chartContainerSx: SxProps<Theme> = {
  width: '100%',
  overflowX: 'auto',
}

export const winnerPercentChangeCellSx = (percentChange: number): SxProps<Theme> => ({
  color: percentChange >= 0 ? 'success.main' : 'error.main',
  fontWeight: 700,
})