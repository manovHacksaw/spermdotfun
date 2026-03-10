import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { cookieToInitialState } from 'wagmi'
import './globals.css'
import WalletContextProvider from '@/components/WalletProvider'
import { SessionWalletProvider } from '@/context/SessionWalletContext'
import { Providers } from '@/components/Providers'
import { Toaster } from 'sonner'

export const metadata: Metadata = {
  title: 'SPRM.FUN — Live Trading Game',
  description: 'Real-time crypto price betting game on Avalanche',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const cookie = headersList.get('cookie')

  return (
    <html lang="en">
      <body>
        <Providers initialState={undefined}>
          <WalletContextProvider>
            <SessionWalletProvider>
              {children}
            </SessionWalletProvider>
          </WalletContextProvider>
        </Providers>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#0D1120',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#F1F5F9',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              borderRadius: '8px',
            },
          }}
          richColors
        />
      </body>
    </html>
  )
}
