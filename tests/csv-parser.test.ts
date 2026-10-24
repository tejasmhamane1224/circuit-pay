import { describe, it, expect } from "vitest";
import { parseRecipientCsv, splitCsvLine } from "../src/lib/csv/parser";
import { PublicKey } from "@solana/web3.js";

describe("CSV Recipient Parser & Validator", () => {
  const validWallet1 = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
  const validWallet2 = "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u";
  const validWallet3 = "DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj";

  it("handles empty and whitespace input", () => {
    const emptyResult = parseRecipientCsv("");
    expect(emptyResult.rows).toHaveLength(0);
    expect(emptyResult.validCount).toBe(0);
    expect(emptyResult.errorCount).toBe(0);

    const whitespaceResult = parseRecipientCsv("   \n\n   \r\n");
    expect(whitespaceResult.rows).toHaveLength(0);
  });

  it("parses valid CSV with headers", () => {
    const csv = `Wallet,Amount,Name
${validWallet1},250.50,Alice Developer
${validWallet2},100.00,Bob Designer`;

    const result = parseRecipientCsv(csv, { tokenDecimals: 6 });
    expect(result.totalRecipients).toBe(2);
    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].wallet).toBe(validWallet1);
    expect(result.rows[0].amountFormatted).toBe("250.50");
    expect(result.rows[0].amountRaw).toBe("250500000"); // 250.50 * 10^6
    expect(result.rows[0].recipientName).toBe("Alice Developer");
    expect(result.rows[1].amountRaw).toBe("100000000"); // 100.00 * 10^6
    expect(result.totalAmountFormatted).toBe("350.50");
    expect(result.totalAmountRaw).toBe("350500000");
  });

  it("parses valid CSV without headers", () => {
    const csv = `${validWallet1},50\n${validWallet2},75.25`;
    const result = parseRecipientCsv(csv);
    expect(result.totalRecipients).toBe(2);
    expect(result.validCount).toBe(2);
    expect(result.rows[0].amountRaw).toBe("50000000");
    expect(result.rows[1].amountRaw).toBe("75250000");
  });

  it("handles quoted fields and escaped quotes", () => {
    const csv = `address,amount,memo
"${validWallet1}","150.00","Consulting, Q4"
${validWallet2},200,"Design ""Special"" Sprint"`;

    const result = parseRecipientCsv(csv);
    expect(result.validCount).toBe(2);
    expect(result.rows[0].recipientName).toBe("Consulting, Q4");
    expect(result.rows[1].recipientName).toBe('Design "Special" Sprint');
  });

  it("detects invalid Base58 format", () => {
    const csv = `wallet,amount\nNotAValidBase58Address0OIl,100`;
    const result = parseRecipientCsv(csv);
    expect(result.validCount).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors).toContain("Invalid Solana Base58 public key format");
  });

  it("detects off-curve PDA addresses when requireOnCurve is true", () => {
    // Generate a known off-curve Program Derived Address
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("circuitpay_test")],
      new PublicKey("11111111111111111111111111111111")
    );
    const pdaAddress = pda.toBase58();

    const csv = `wallet,amount\n${pdaAddress},100`;
    const result = parseRecipientCsv(csv, { requireOnCurve: true });
    expect(result.validCount).toBe(0);
    expect(result.rows[0].errors.some((e) => e.includes("off-curve"))).toBe(true);
  });

  it("detects duplicate wallet addresses and flags all offending rows", () => {
    const csv = `wallet,amount\n${validWallet1},100\n${validWallet2},200\n${validWallet1},300`;
    const result = parseRecipientCsv(csv);
    expect(result.validCount).toBe(1); // only validWallet2 is valid
    expect(result.errorCount).toBe(2); // row 2 and row 4 (1-indexed including header)
    expect(result.duplicateWallets).toContain(validWallet1);
    expect(result.rows[0].errors.some((e) => e.includes("Duplicate wallet detected"))).toBe(true);
    expect(result.rows[2].errors.some((e) => e.includes("Duplicate wallet detected"))).toBe(true);
  });

  it("rejects decimal precision exceeding token decimals", () => {
    // 7 decimals for USDC (max 6)
    const csvUSDC = `wallet,amount\n${validWallet1},10.1234567`;
    const resultUSDC = parseRecipientCsv(csvUSDC, { tokenDecimals: 6 });
    expect(resultUSDC.validCount).toBe(0);
    expect(resultUSDC.rows[0].errors.some((e) => e.includes("exceeds maximum token precision"))).toBe(true);

    // 6 decimals for USDC is accepted
    const csvValidUSDC = `wallet,amount\n${validWallet1},10.123456`;
    const resultValidUSDC = parseRecipientCsv(csvValidUSDC, { tokenDecimals: 6 });
    expect(resultValidUSDC.validCount).toBe(1);
    expect(resultValidUSDC.rows[0].amountRaw).toBe("10123456");

    // SOL allows 9 decimals
    const csvSOL = `wallet,amount\n${validWallet1},0.123456789`;
    const resultSOL = parseRecipientCsv(csvSOL, { tokenDecimals: 9 });
    expect(resultSOL.validCount).toBe(1);
    expect(resultSOL.rows[0].amountRaw).toBe("123456789");
  });

  it("rejects non-positive numbers and negative amounts", () => {
    const csv = `wallet,amount
${validWallet1},0
${validWallet2},-50
${validWallet3},abc`;

    const result = parseRecipientCsv(csv);
    expect(result.validCount).toBe(0);
    expect(result.errorCount).toBe(3);
    expect(result.rows[0].errors.some((e) => e.includes("greater than zero"))).toBe(true);
    expect(result.rows[1].errors.some((e) => e.includes("valid positive number"))).toBe(true);
    expect(result.rows[2].errors.some((e) => e.includes("valid positive number"))).toBe(true);
  });

  it("enforces maximum single recipient transfer cap", () => {
    const csv = `wallet,amount\n${validWallet1},2000000`;
    const result = parseRecipientCsv(csv, { maxAmountPerRecipient: 1_000_000 });
    expect(result.validCount).toBe(0);
    expect(result.rows[0].errors.some((e) => e.includes("exceeds maximum allowable"))).toBe(true);
  });

  it("splitCsvLine parses simple and complex lines accurately", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
    expect(splitCsvLine('"hello, world",123,"test"')).toEqual(["hello, world", "123", "test"]);
    expect(splitCsvLine('  spaced  ,  "quoted spaced"  ')).toEqual(["spaced", "quoted spaced"]);
  });

  it("does not drop valid row 0 when memo contains header keywords like 'token' or 'wallet'", () => {
    const csv = `${validWallet1},100,Token Grant Q4\n${validWallet2},200,Wallet Migration`;
    const result = parseRecipientCsv(csv);
    expect(result.totalRecipients).toBe(2);
    expect(result.validCount).toBe(2);
    expect(result.rows[0].wallet).toBe(validWallet1);
    expect(result.rows[0].recipientName).toBe("Token Grant Q4");
    expect(result.rows[1].recipientName).toBe("Wallet Migration");
  });

  it("preserves apostrophes in recipient names without breaking CSV columns", () => {
    const csv = `${validWallet1},100,Bob's Dev\n${validWallet2},150,O'Connor`;
    const result = parseRecipientCsv(csv);
    expect(result.validCount).toBe(2);
    expect(result.rows[0].recipientName).toBe("Bob's Dev");
    expect(result.rows[1].recipientName).toBe("O'Connor");
  });

  it("handles high precision SOL amounts without truncation to 2 decimals", () => {
    const csv = `${validWallet1},0.005`;
    const result = parseRecipientCsv(csv, { tokenDecimals: 9 });
    expect(result.validCount).toBe(1);
    expect(result.rows[0].amountRaw).toBe("5000000"); // 0.005 * 10^9
    expect(result.totalAmountFormatted).toBe("0.005");
  });

  it("handles Unicode characters and emojis in recipient memos", () => {
    const csv = `${validWallet1},250,Alice 🚀 Web3 Core\n${validWallet2},175,François Jérôme`;
    const result = parseRecipientCsv(csv);
    expect(result.validCount).toBe(2);
    expect(result.rows[0].recipientName).toBe("Alice 🚀 Web3 Core");
    expect(result.rows[1].recipientName).toBe("François Jérôme");
  });
});
