import type { Metadata } from "next";
import { Space_Grotesk, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";
import AppNav from "../components/AppNav";

const headingFont = Space_Grotesk({
    subsets: ["latin"],
    variable: "--font-heading",
    display: "swap",
});

const bodyFont = Source_Sans_3({
    subsets: ["latin"],
    variable: "--font-body",
    display: "swap",
});

export const metadata: Metadata = {
    title: "FARM RWA Dashboard",
    description: "Real World Asset NAV Oracle Dashboard",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${headingFont.variable} ${bodyFont.variable}`}>
                <style>{`
                  :root { color-scheme: dark; }
                  html, body { margin: 0; min-height: 100%; background: #050b14; color: #f8fafc; font-family: var(--font-body), system-ui, sans-serif; }
                  * { box-sizing: border-box; }
                  a { color: inherit; text-decoration: none; }
                                    nav { backdrop-filter: blur(12px); }
                                    main { max-width: 80rem; margin: 0 auto; padding: 2rem 1.5rem 3rem; }
                                    section { box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22); }
                                    h1, h2, h3, h4 { font-family: var(--font-heading), system-ui, sans-serif; letter-spacing: -0.02em; margin: 0; }
                                    p { margin: 0; }
                                    input, textarea, button { font: inherit; }
                                    table { border-collapse: collapse; width: 100%; }
                                    th, td { vertical-align: top; }
                                    .mirror-nav { position: sticky; top: 0; z-index: 30; border-bottom: 1px solid rgba(51, 65, 85, 0.8); background: rgba(2, 6, 23, 0.92); }
                                    .mirror-nav-inner { max-width: 80rem; margin: 0 auto; padding: 0.75rem 1.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
                                    .mirror-nav-link { display: inline-flex; align-items: center; border: 1px solid rgba(71, 85, 105, 1); border-radius: 0.5rem; padding: 0.35rem 0.75rem; color: #e2e8f0; background: rgba(15, 23, 42, 0.6); }
                                    .mirror-nav-link:hover { border-color: rgba(34, 211, 238, 0.65); color: #67e8f9; }
                                    .mirror-panel { background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.92)); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 1.25rem; padding: 1.5rem; }
                                    .mirror-panel + .mirror-panel { margin-top: 1.5rem; }
                                    .mirror-summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.75rem; margin-top: 1.5rem; }
                                    .mirror-card { background: rgba(2, 6, 23, 0.72); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 0.75rem; padding: 0.75rem; }
                                    .mirror-card-label { font-size: 0.72rem; color: #94a3b8; margin-bottom: 0.25rem; }
                                    .mirror-card-value { font-size: 0.98rem; }
                                    .mirror-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin-top: 1.25rem; }
                                    .mirror-input { width: 100%; border: 1px solid rgba(51, 65, 85, 1); background: #020617; color: #e2e8f0; border-radius: 0.5rem; padding: 0.625rem 0.75rem; }
                                    .mirror-btn { border: 1px solid rgba(34, 211, 238, 0.4); background: rgba(34, 211, 238, 0.08); color: #a5f3fc; border-radius: 0.5rem; padding: 0.625rem 1rem; cursor: pointer; }
                                    .mirror-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                                    .mirror-table-wrap { overflow-x: auto; }
                                    .mirror-table { width: 100%; min-width: 56rem; font-size: 0.875rem; }
                                    .mirror-table thead th { color: #94a3b8; text-align: left; padding-bottom: 0.5rem; }
                                    .mirror-table tbody tr { border-top: 1px solid rgba(51, 65, 85, 1); }
                                    .mirror-table td { padding: 0.75rem 0; }
                                    .mirror-table .num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-variant-numeric: tabular-nums; }
                                    .mirror-table .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
                                    .mirror-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.2rem 0.55rem; font-size: 0.75rem; background: rgba(15, 23, 42, 0.88); border: 1px solid rgba(51, 65, 85, 1); }
                                    .mirror-muted { color: #94a3b8; }
                                    .accent-rare { color: #fcd34d; }
                                    .accent-normal { color: #67e8f9; }
                `}</style>
                <Providers>
                    <AppNav />
                    {children}
                </Providers>
            </body>
        </html>
    );
}
