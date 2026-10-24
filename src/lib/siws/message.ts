import crypto from "node:crypto";

export interface SIWSMessageParams {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version?: string;
  chainId: string; // e.g. "solana:mainnet-beta" or "solana:devnet"
  nonce: string;
  issuedAt: string; // ISO 8601
  expirationTime?: string; // ISO 8601
}

export interface ParsedSIWSMessage {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createSIWSMessage(params: SIWSMessageParams): string {
  const statement = params.statement || "Sign in with Solana to authenticate with CircuitPay.";
  const version = params.version || "1";
  
  const lines: string[] = [
    `${params.domain} wants you to sign in with your Solana account:`,
    params.address,
    "",
    statement,
    "",
    `URI: ${params.uri}`,
    `Version: ${version}`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
  ];

  if (params.expirationTime) {
    lines.push(`Expiration Time: ${params.expirationTime}`);
  }

  return lines.join("\n");
}

export function parseSIWSMessage(messageText: string): ParsedSIWSMessage | null {
  try {
    const lines = messageText.split("\n");
    if (lines.length < 9) return null;

    const domainMatch = lines[0].match(/^(.*?) wants you to sign in with your Solana account:$/);
    if (!domainMatch) return null;
    const domain = domainMatch[1];
    const address = lines[1]?.trim();
    if (!address) return null;

    let statement: string | undefined;
    let fieldStartIndex = 3;

    // Line 2 is empty, line 3 is statement, line 4 is empty, lines 5+ are fields
    if (lines[2] === "" && lines[4] === "") {
      statement = lines[3];
      fieldStartIndex = 5;
    }

    const fields: Record<string, string> = {};
    for (let i = fieldStartIndex; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).trim();
      const val = line.slice(separatorIndex + 1).trim();
      fields[key] = val;
    }

    if (!fields["URI"] || !fields["Version"] || !fields["Chain ID"] || !fields["Nonce"] || !fields["Issued At"]) {
      return null;
    }

    return {
      domain,
      address,
      statement,
      uri: fields["URI"],
      version: fields["Version"],
      chainId: fields["Chain ID"],
      nonce: fields["Nonce"],
      issuedAt: fields["Issued At"],
      expirationTime: fields["Expiration Time"],
    };
  } catch {
    return null;
  }
}
