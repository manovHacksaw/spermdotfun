import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import WalletContextProvider from '@/components/WalletProvider'
import { SessionWalletProvider } from '@/context/SessionWalletContext'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SPRMFUN — Live Grid',
  description: 'Real-time multiplier grid chart',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletContextProvider>
          <SessionWalletProvider>
            {children}
          </SessionWalletProvider>
        </WalletContextProvider>
      </body>
    </html>
  )
}
