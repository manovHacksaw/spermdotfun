'use client'

import { useState, useEffect } from 'react'
import { useEvmWallet } from '@/components/WalletProvider'
import { spermTheme } from '@/components/theme/spermTheme'
import { Droplet, Timer, ShieldCheck, AlertCircle } from 'lucide-react'
import { ethers } from 'ethers'

const FAUCET_ABI = [
    "function claim() external",
    "function timeUntilNextClaim(address user) external view returns (uint256)",
    "function claimAmount() external view returns (uint256)",
    "function cooldown() external view returns (uint256)",
]

export default function FaucetPage() {
    const { address, connected, signer, connect, wrongNetwork, switchToFuji } = useEvmWallet()
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' })
    const [countdown, setCountdown] = useState<string | null>(null)

    // Faucet Address (Placeholder - should be in .env)
    const FAUCET_ADDRESS = process.env.NEXT_PUBLIC_FAUCET_ADDRESS || '0x0000000000000000000000000000000000000000'

    const checkCooldown = async () => {
        if (!address) return
        try {
            const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL)
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, provider)
            const remaining: bigint = await contract.timeUntilNextClaim(address)
            if (remaining > 0n) {
                const secs = Number(remaining)
                const hours = Math.floor(secs / 3600)
                const minutes = Math.floor((secs % 3600) / 60)
                setCountdown(`${hours}h ${minutes}m`)
            } else {
                setCountdown(null)
            }
        } catch (e) {
            console.error('Failed to check cooldown', e)
        }
    }

    useEffect(() => {
        if (connected) checkCooldown()
        const timer = setInterval(checkCooldown, 60000)
        return () => clearInterval(timer)
    }, [connected, address])

    const handleClaim = async () => {
        if (!signer) return
        setLoading(true)
        setStatus({ type: null, message: '' })

        try {
            const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, signer)
            const tx = await contract.claim()
            setStatus({ type: 'success', message: 'Transaction submitted! Waiting for confirmation...' })
            await tx.wait()
            setStatus({ type: 'success', message: 'Successfully claimed 50 SPRM!' })
            checkCooldown()
        } catch (e: any) {
            console.error(e)
            const msg = e.reason || e.message || 'Transaction failed'
            setStatus({ type: 'error', message: msg })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: spermTheme.bgBase,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            color: spermTheme.textPrimary,
            fontFamily: 'Inter, sans-serif'
        }}>
            <div style={{
                width: '100%',
                maxWidth: '480px',
                background: spermTheme.bgGlassStrong,
                backdropFilter: 'blur(20px)',
                borderRadius: '24px',
                border: `1px solid ${spermTheme.borderChrome}`,
                padding: '40px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                textAlign: 'center'
            }}>
                {/* Header */}
                <div style={{
                    width: '80px',
                    height: '80px',
                    background: spermTheme.accentSoft,
                    borderRadius: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 24px',
                    border: `1px solid ${spermTheme.accentBorder}`,
                    color: spermTheme.accent
                }}>
                    <Droplet size={40} />
                </div>

                <h1 style={{ fontSize: '32px', fontWeight: 900, marginBottom: '12px', letterSpacing: '-0.5px' }}>
                    SPRM Faucet
                </h1>
                <p style={{ color: spermTheme.textSecondary, marginBottom: '32px', lineHeight: 1.6 }}>
                    Claim your daily dose of 50 SPRM tokens to start betting in the aquarium.
                </p>

                {/* Status Card */}
                <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '16px',
                    padding: '20px',
                    marginBottom: '32px',
                    border: `1px solid ${spermTheme.borderFaint}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '14px', color: spermTheme.textTertiary }}>Amount</span>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: spermTheme.accent }}>50 SPRM</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '14px', color: spermTheme.textTertiary }}>Cooldown</span>
                        <span style={{ fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Timer size={14} /> 24 Hours
                        </span>
                    </div>
                </div>

                {!connected ? (
                    <button
                        onClick={connect}
                        style={{
                            width: '100%',
                            padding: '16px',
                            background: spermTheme.accent,
                            border: 'none',
                            borderRadius: '12px',
                            color: '#000',
                            fontSize: '16px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'transform 0.2s',
                        }}
                    >
                        Connect Wallet
                    </button>
                ) : wrongNetwork ? (
                    <button
                        onClick={switchToFuji}
                        style={{
                            width: '100%',
                            padding: '16px',
                            background: spermTheme.error,
                            border: 'none',
                            borderRadius: '12px',
                            color: '#fff',
                            fontSize: '16px',
                            fontWeight: 800,
                            cursor: 'pointer',
                        }}
                    >
                        Switch to Avalanche Fuji
                    </button>
                ) : (
                    <button
                        disabled={loading || !!countdown}
                        onClick={handleClaim}
                        style={{
                            width: '100%',
                            padding: '16px',
                            background: (loading || countdown) ? 'rgba(255,255,255,0.1)' : spermTheme.accent,
                            border: 'none',
                            borderRadius: '12px',
                            color: (loading || countdown) ? spermTheme.textTertiary : '#000',
                            fontSize: '16px',
                            fontWeight: 800,
                            cursor: (loading || countdown) ? 'not-allowed' : 'pointer',
                            position: 'relative',
                            overflow: 'hidden'
                        }}
                    >
                        {loading ? 'Processing...' : countdown ? `Wait ${countdown}` : 'Claim Tokens'}
                    </button>
                )}

                {status.message && (
                    <div style={{
                        marginTop: '20px',
                        padding: '12px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: status.type === 'error' ? 'rgba(227,150,170,0.1)' : 'rgba(152,214,194,0.1)',
                        color: status.type === 'error' ? spermTheme.error : spermTheme.success,
                        border: `1px solid ${status.type === 'error' ? 'rgba(227,150,170,0.3)' : 'rgba(152,214,194,0.3)'}`
                    }}>
                        {status.type === 'error' ? <AlertCircle size={16} /> : <ShieldCheck size={16} />}
                        {status.message}
                    </div>
                )}

                <div style={{ marginTop: '24px', fontSize: '12px', color: spermTheme.textTertiary }}>
                    Avalanche Fuji Testnet • SPRM Token (ERC20)
                </div>
            </div>
        </div>
    )
}
