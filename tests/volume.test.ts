import { describe, it, expect } from "vitest";
import { calculateQualifyingVolume, isCircularOrWashTransfer } from "@/lib/multihopper/volume";

describe("Superteam Earn MultiHopper Challenge Volume Formula Math", () => {
  it("calculates exact qualifying volume using fees / 0.0025", () => {
    // 250 USD in collected fees = exactly 100,000 USD volume ($100k threshold)
    const result100k = calculateQualifyingVolume(250, "mainnet-beta");
    expect(result100k.qualifyingVolumeUsd).toBe(100000);
    expect(result100k.collectedFeeUsd).toBe(250);
    expect(result100k.integratorFeeShareUsd).toBe(125); // 50% split
    expect(result100k.qualifiesForChallenge).toBe(true);
    expect(result100k.thresholdProgressPercent).toBe(100);

    // 125 USD in collected fees = 50,000 USD volume (50% progress)
    const result50k = calculateQualifyingVolume(125, "mainnet-beta");
    expect(result50k.qualifyingVolumeUsd).toBe(50000);
    expect(result50k.qualifiesForChallenge).toBe(false);
    expect(result50k.thresholdProgressPercent).toBe(50);

    // 500 USD in collected fees = 200,000 USD volume
    const result200k = calculateQualifyingVolume(500, "mainnet-beta");
    expect(result200k.qualifyingVolumeUsd).toBe(200000);
    expect(result200k.qualifiesForChallenge).toBe(true);
    expect(result200k.thresholdProgressPercent).toBe(100);
  });

  it("excludes Devnet transfers from qualifying volume ($0)", () => {
    const devnetResult = calculateQualifyingVolume(250, "devnet");
    expect(devnetResult.qualifyingVolumeUsd).toBe(0);
    expect(devnetResult.isMainnet).toBe(false);
    expect(devnetResult.qualifiesForChallenge).toBe(false);
    expect(devnetResult.thresholdProgressPercent).toBe(0);
    expect(devnetResult.disqualificationReason).toContain("Devnet transfers are excluded");
  });

  it("excludes failed or refunded transfers ($0)", () => {
    const ineligibleResult = calculateQualifyingVolume(250, "mainnet-beta", false);
    expect(ineligibleResult.qualifyingVolumeUsd).toBe(0);
    expect(ineligibleResult.qualifiesForChallenge).toBe(false);
    expect(ineligibleResult.disqualificationReason).toContain("marked ineligible");
  });

  it("detects and excludes circular or wash-trading transfers where sender is in recipients", () => {
    const sender = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
    const recipients = [
      "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u",
      "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4", // Sender self-transfer!
    ];

    expect(isCircularOrWashTransfer(sender, recipients)).toBe(true);
    expect(isCircularOrWashTransfer(sender, ["7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u"])).toBe(false);

    const washResult = calculateQualifyingVolume(250, "mainnet-beta", true, {
      senderWallet: sender,
      recipientWallets: recipients,
    });
    expect(washResult.qualifyingVolumeUsd).toBe(0);
    expect(washResult.qualifiesForChallenge).toBe(false);
    expect(washResult.disqualificationReason).toContain("Circular or wash-trading");
  });

  it("handles zero fees cleanly", () => {
    const zeroResult = calculateQualifyingVolume(0, "mainnet-beta");
    expect(zeroResult.qualifyingVolumeUsd).toBe(0);
    expect(zeroResult.integratorFeeShareUsd).toBe(0);
    expect(zeroResult.qualifiesForChallenge).toBe(false);
    expect(zeroResult.thresholdProgressPercent).toBe(0);
  });

  it("throws error on negative or invalid numbers", () => {
    expect(() => calculateQualifyingVolume(-10, "mainnet-beta")).toThrow();
    expect(() => calculateQualifyingVolume(NaN, "mainnet-beta")).toThrow();
    expect(() => calculateQualifyingVolume(Infinity, "mainnet-beta")).toThrow();
  });
});
