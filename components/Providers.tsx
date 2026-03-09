'use client';

import * as React from 'react';
import {
    RainbowKitProvider,
    getDefaultConfig,
    darkTheme,
} from '@rainbow-me/rainbowkit';
import { State, WagmiProvider, cookieStorage, createStorage } from 'wagmi';
import { avalancheFuji } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';

function makeConfig() {
    const fujiChain = {
        ...avalancheFuji,
        rpcUrls: {
            default: {
                http: [process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'],
            },
            public: {
                http: [process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'],
            },
        },
    };
    return getDefaultConfig({
        appName: 'SpermFun',
        projectId: 'd3f6d7e0d37d1e846065cbef919de6ee',
        chains: [fujiChain],
        ssr: true,
        storage: createStorage({
            storage: cookieStorage,
        }),
    });
}

export function Providers({
    children,
    initialState,
}: {
    children: React.ReactNode;
    initialState?: State;
}) {
    const [config] = React.useState(makeConfig);
    const [queryClient] = React.useState(() => new QueryClient());

    return (
        <WagmiProvider config={config} initialState={initialState}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider
                    theme={darkTheme({
                        accentColor: '#C58CFF',
                        accentColorForeground: 'white',
                        borderRadius: 'medium',
                        fontStack: 'system',
                        overlayBlur: 'small',
                    })}
                >
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
