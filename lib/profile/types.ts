export type ProfileTab = 'stats' | 'transfer' | 'transactions' | 'settings'

export type ProfileTimeFilter = '24H' | '7D' | '1M' | 'ALL'

export interface ProfileSettings {
  nickname: string
  email: string
  avatarDataUrl: string | null
  clientSeed: string
  referralCode: string
  volume: number
}

export interface ProfileTransaction {
  id: string
  txSignature: string
  eventIndex: number
  wallet: string
  sourceWallet: string
  game: 'crash'
  betAmount: number
  payout: number
  net: number
  won: boolean
  betPda?: string
  boxX?: number
  boxRow?: number
  winningRow?: number
  seedIndex?: number
  timestamp: number
  resolvedAt: string
}

export interface WalletProfileStoreV1 {
  version: 1
  settings: ProfileSettings
  transactions: ProfileTransaction[]
}

export interface ProfileStats {
  gamesPlayed: number
  wins: number
  losses: number
  winRate: number
  totalWagered: number
  totalPayout: number
  netProfit: number
  grossProfit: number
  totalLoss: number
  avgBet: number
  avgPayout: number
}

export interface ProfilePnlPoint {
  timestamp: number
  cumulativeNet: number
}

export interface ProfileOverviewResponse {
  wallet: string
  requestedWallet: string
  linkedSessionWallets: string[]
  range: ProfileTimeFilter
  settings: ProfileSettings
  stats: ProfileStats
  pnlSeries: ProfilePnlPoint[]
  transactions: ProfileTransaction[]
  transactionsPageInfo: {
    hasMore: boolean
    nextCursor: string | null
  }
}

export interface ProfileTransactionsResponse {
  wallet: string
  requestedWallet: string
  linkedSessionWallets: string[]
  range: ProfileTimeFilter
  items: ProfileTransaction[]
  hasMore: boolean
  nextCursor: string | null
}

export interface ProfileBetResultEvent {
  user?: string
  betPda?: string
  box_x?: number
  box_row?: number
  winning_row?: number
  won?: boolean
  bet_amount?: number
  payout?: number
  tx_signature?: string
  seed_index?: number
  timestamp?: number
}
