import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function truncateAddress(address: string, chars: number = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatUsd(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatTokenAmount(rawAmount: string | number, decimals: number = 6): string {
  const val = BigInt(rawAmount.toString());
  const divisor = BigInt(10 ** decimals);
  const integerPart = val / divisor;
  const remainder = val % divisor;
  
  if (remainder === BigInt(0)) {
    return integerPart.toString();
  }
  
  const remainderStr = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${integerPart}.${remainderStr}`;
}

export function parseTokenAmountToRaw(amount: string | number, decimals: number = 6): string {
  const str = amount.toString().trim();
  const [intPart, fracPart = ""] = str.split(".");
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const total = BigInt(intPart || "0") * BigInt(10 ** decimals) + BigInt(paddedFrac);
  return total.toString();
}
