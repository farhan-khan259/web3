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
                <Providers>
                    <AppNav />
                    {children}
                </Providers>
            </body>
        </html>
    );
}
