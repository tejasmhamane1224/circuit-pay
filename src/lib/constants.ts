export const NEXT_PUBLIC_MULTIHOPPER_CONTRACT =
  process.env.NEXT_PUBLIC_MULTIHOPPER_CONTRACT || "";

export const MULTIHOPPER_PROGRAM_IDS = {
  CORE: process.env.NEXT_PUBLIC_MULTIHOPPER_CONTRACT || "",
  ORCHESTRATOR: process.env.NEXT_PUBLIC_MULTIHOPPER_ORCHESTRATOR || "",
  TRANSFER_HOOK_GUARD: process.env.NEXT_PUBLIC_MULTIHOPPER_TRANSFER_HOOK || "",
} as const;

export const INTEGRATION_IDENTIFIER = "circuitpay_treasury_v1";

export const MULTIHOPPER_API_URLS = {
  DEVNET: "https://devnet.multihopper.com/api/v1",
  MAINNET: "https://multihopper.com/api/v1",
} as const;

export const KNOWN_TOKENS = {
  MAINNET_USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  DEVNET_USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  WSOL: "So11111111111111111111111111111111111111112",
} as const;

export const MULTIHOPPER_RULES = {
  MAX_DESTINATIONS_PER_CHUNK: 20,
  MIN_HOPS: 3,
  MAX_HOPS: 10,
  DEFAULT_HOPS: 4,
  DEFAULT_ARRIVAL_SECONDS: 900,
  SCREENING_FEE_SOL: 0.002, // 0.002 SOL per screened address on mainnet
  PERCENT_FEE_BPS: 50, // 0.50% total MultiHopper fee
  INTEGRATOR_SHARE_PERCENT: 0.5, // 50% split of MultiHopper percentage and flat fee
  QUALIFYING_VOLUME_FEE_DIVISOR: 0.0025, // Challenge formula: collected_fees / 0.0025
  MIN_QUALIFYING_VOLUME_USD: 100000, // $100k production mainnet threshold
} as const;

export const SUPPORTED_NETWORKS = ["mainnet-beta", "devnet"] as const;
export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];
