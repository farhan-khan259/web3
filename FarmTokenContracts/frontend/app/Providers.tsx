"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../lib/rainbowKitConfig";

export default function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient());

    useEffect(() => {
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = String(event.reason ?? "");

            // Ignore extension-level MetaMask connection failures so they don't surface as app crashes.
            if (reason.includes("Failed to connect to MetaMask")) {
                event.preventDefault();
            }
        };

        window.addEventListener("unhandledrejection", handleUnhandledRejection);
        return () => {
            window.removeEventListener("unhandledrejection", handleUnhandledRejection);
        };
    }, []);

    return (
        <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
