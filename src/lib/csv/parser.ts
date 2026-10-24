import { PublicKey } from "@solana/web3.js";

export interface ParsedCsvRecipient {
  rowNumber: number;
  wallet: string;
  amountFormatted: string;
  amountRaw: string;
  recipientName?: string;
  isValid: boolean;
  errors: string[];
}

export interface CsvParseResult {
  rows: ParsedCsvRecipient[];
  validRows: ParsedCsvRecipient[];
  invalidRows: ParsedCsvRecipient[];
  totalRecipients: number;
  validCount: number;
  errorCount: number;
  totalAmountFormatted: string;
  totalAmountRaw: string;
  duplicateWallets: string[];
}

export interface CsvParseOptions {
  tokenDecimals?: number; // default 6 for USDC, 9 for SOL
  maxAmountPerRecipient?: number; // optional upper bound cap
  requireOnCurve?: boolean; // default true (Solana user accounts must be on-curve)
  maxRecipients?: number; // default 500 per batch UI-side cap
}

/**
 * Formats a raw token amount (BigInt base units) into a human-readable decimal string
 * with exact precision, without floating point truncation or rounding.
 */
export function formatAmountFromRaw(amountRaw: string | bigint, decimals: number): string {
  const rawBig = typeof amountRaw === "bigint" ? amountRaw : BigInt(amountRaw || "0");
  const base = BigInt(10) ** BigInt(decimals);
  const integerPart = rawBig / base;
  const fractionBig = rawBig % base;
  if (fractionBig === BigInt(0)) {
    return `${integerPart}.00`;
  }
  let fractionStr = fractionBig.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fractionStr.length < 2) {
    fractionStr = fractionStr.padEnd(2, "0");
  }
  return `${integerPart}.${fractionStr}`;
}

/**
 * Parses CSV content strictly following RFC 4180 records and fields.
 * Handles newlines inside double-quoted fields, escaped quotes, and commas.
 */
export interface ParsedCsvRecord {
  rowNumber: number;
  cols: string[];
}

export function parseRfc4180Records(text: string): ParsedCsvRecord[] {
  const records: ParsedCsvRecord[] = [];
  let currentFields: string[] = [];
  let currentField = "";
  let insideQuotes = false;
  let recordRowNumber = 1;
  let currentRowNumber = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (insideQuotes && text[i + 1] === '"') {
        // Escaped double quote ("")
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentFields.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      currentFields.push(currentField.trim());
      currentField = "";

      if (currentFields.some((f) => f.length > 0)) {
        records.push({ rowNumber: recordRowNumber, cols: currentFields });
      }

      currentFields = [];
      currentRowNumber++;
      recordRowNumber = currentRowNumber;
    } else {
      if (char === "\n") {
        currentRowNumber++;
      }
      currentField += char;
    }
  }

  currentFields.push(currentField.trim());
  if (currentFields.some((f) => f.length > 0)) {
    records.push({ rowNumber: recordRowNumber, cols: currentFields });
  }

  return records;
}

/**
 * Splits a CSV line strictly following RFC 4180 double-quote rules.
 * Apostrophes/single quotes inside strings (e.g. O'Connor, Bob's Dev) are preserved.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        // Escaped double quote ("")
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parses and validates CSV content for Solana MultiHopper payouts
 */
export function parseRecipientCsv(
  csvContent: string,
  options: CsvParseOptions = {}
): CsvParseResult {
  const tokenDecimals = options.tokenDecimals ?? 6;
  const maxAmount = options.maxAmountPerRecipient ?? 1_000_000;
  const requireOnCurve = options.requireOnCurve ?? true;
  const maxRecipients = options.maxRecipients ?? 500;

  if (!csvContent || csvContent.trim().length === 0) {
    return {
      rows: [],
      validRows: [],
      invalidRows: [],
      totalRecipients: 0,
      validCount: 0,
      errorCount: 0,
      totalAmountFormatted: "0",
      totalAmountRaw: "0",
      duplicateWallets: [],
    };
  }

  const records = parseRfc4180Records(csvContent);
  if (records.length === 0) {
    return {
      rows: [],
      validRows: [],
      invalidRows: [],
      totalRecipients: 0,
      validCount: 0,
      errorCount: 0,
      totalAmountFormatted: "0",
      totalAmountRaw: "0",
      duplicateWallets: [],
    };
  }

  const rows: ParsedCsvRecipient[] = [];

  // Track wallet address occurrences for duplicate detection: wallet -> array of row numbers
  const walletRowMap = new Map<string, number[]>();

  // Determine if record 0 is a header line
  let startIndex = 0;
  const firstCols = records[0].cols;
  const firstCol0 = firstCols[0]?.replace(/^["']|["']$/g, "").trim() || "";
  let firstColIsPubkey = false;
  try {
    if (firstCol0) {
      new PublicKey(firstCol0);
      firstColIsPubkey = true;
    }
  } catch {
    firstColIsPubkey = false;
  }

  if (!firstColIsPubkey) {
    const firstLineCols = firstCols.map((c) => c.toLowerCase());
    const headerKeywords = ["wallet", "address", "recipient", "amount", "name", "token", "memo"];
    const isHeader = firstLineCols.some((col) =>
      headerKeywords.some((keyword) => col.includes(keyword))
    );

    if (isHeader) {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < records.length; i++) {
    const rec = records[i];
    const rowNumber = rec.rowNumber;
    const cols = rec.cols;
    const errors: string[] = [];

    const rawWallet = cols[0] ? cols[0].replace(/^["']|["']$/g, "").trim() : "";
    const rawAmount = cols[1] ? cols[1].replace(/^["']|["']$/g, "").trim() : "";
    const rawName = cols[2] ? cols[2].replace(/^["']|["']$/g, "").trim() : undefined;

    // 1. Wallet Address Validation
    if (!rawWallet) {
      errors.push("Missing wallet address");
    } else {
      try {
        const pubkey = new PublicKey(rawWallet);
        const onCurve = PublicKey.isOnCurve(pubkey.toBuffer());
        if (requireOnCurve && !onCurve) {
          errors.push("Solana public key is off-curve (PDA or contract address; must be standard wallet)");
        }

        // Record for duplicate detection
        const existing = walletRowMap.get(rawWallet) || [];
        existing.push(rowNumber);
        walletRowMap.set(rawWallet, existing);
      } catch {
        errors.push("Invalid Solana Base58 public key format");
      }
    }

    // 2. Amount Validation
    let amountRaw = "0";
    if (!rawAmount) {
      errors.push("Missing amount");
    } else if (!/^\d+(\.\d+)?$/.test(rawAmount)) {
      errors.push("Amount must be a valid positive number");
    } else {
      const numVal = parseFloat(rawAmount);
      if (isNaN(numVal) || numVal <= 0) {
        errors.push("Amount must be greater than zero");
      } else if (numVal > maxAmount) {
        errors.push(`Amount exceeds maximum allowable single transfer cap (${maxAmount.toLocaleString()})`);
      } else {
        // Decimal precision check
        const parts = rawAmount.split(".");
        const decimals = parts[1] ? parts[1].length : 0;
        if (decimals > tokenDecimals) {
          errors.push(
            `Decimal precision (${decimals}) exceeds maximum token precision (${tokenDecimals} decimals)`
          );
        } else {
          // Convert to base units using BigInt to prevent IEEE-754 floating point errors
          const integerPart = BigInt(parts[0]);
          const fractionalStr = (parts[1] || "").padEnd(tokenDecimals, "0").slice(0, tokenDecimals);
          const fractionalPart = BigInt(fractionalStr || "0");
          amountRaw = (integerPart * (BigInt(10) ** BigInt(tokenDecimals)) + fractionalPart).toString();
        }
      }
    }

    // 3. Name validation
    if (rawName && rawName.length > 100) {
      errors.push("Recipient name cannot exceed 100 characters");
    }

    // 4. Batch recipient cap check (max 500 recipients per batch)
    if (rows.length >= maxRecipients) {
      errors.push(`Recipient cap exceeded (maximum ${maxRecipients} recipients allowed per batch)`);
    }

    rows.push({
      rowNumber,
      wallet: rawWallet,
      amountFormatted: rawAmount,
      amountRaw,
      recipientName: rawName,
      isValid: errors.length === 0,
      errors,
    });
  }

  // 4. Duplicate wallet detection pass
  const duplicateWallets: string[] = [];
  for (const [wallet, rowNumbers] of walletRowMap.entries()) {
    if (rowNumbers.length > 1) {
      duplicateWallets.push(wallet);
      for (const row of rows) {
        if (row.wallet === wallet) {
          const otherRows = rowNumbers.filter((r) => r !== row.rowNumber);
          row.errors.push(`Duplicate wallet detected (also on row ${otherRows.join(", ")})`);
          row.isValid = false;
        }
      }
    }
  }

  const validRows = rows.filter((r) => r.isValid);
  const invalidRows = rows.filter((r) => !r.isValid);

  const totalRawBig = validRows.reduce(
    (acc, r) => acc + BigInt(r.amountRaw),
    BigInt(0)
  );

  return {
    rows,
    validRows,
    invalidRows,
    totalRecipients: rows.length,
    validCount: validRows.length,
    errorCount: invalidRows.length,
    totalAmountFormatted: formatAmountFromRaw(totalRawBig, tokenDecimals),
    totalAmountRaw: totalRawBig.toString(),
    duplicateWallets,
  };
}
