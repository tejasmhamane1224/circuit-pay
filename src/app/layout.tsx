import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SolanaWalletProvider } from "@/components/providers/SolanaWalletProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { PostHogProvider } from "@/components/providers/PostHogProvider";

export const metadata: Metadata = {
  title: "CircuitPay | Non-Custodial MultiHopper Routed Payroll & Treasury on Solana",
  description:
    "Production-grade, non-custodial multi-hop payout engine on Solana powered by MultiHopper. Built for Superteam Earn MultiHopper Challenge.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full dark antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 selection:bg-indigo-500/30 selection:text-indigo-200">
        <SolanaWalletProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
