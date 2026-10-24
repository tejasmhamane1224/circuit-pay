import { MultiHopperClient } from "./client";
import { MultiHopperMockServer } from "./mock-server";
import type { SupportedNetwork } from "../constants";

// Global singleton mock server for local browser demo and test suites
const globalForMock = globalThis as unknown as { globalMockServer?: MultiHopperMockServer };
export const globalMockServer = globalForMock.globalMockServer ?? new MultiHopperMockServer();
globalForMock.globalMockServer = globalMockServer;

export function isMultiHopperMock(): boolean {
  const apiKey = process.env.MULTIHOPPER_API_KEY || "";
  return (
    process.env.MULTIHOPPER_USE_MOCK === "true" ||
    (!apiKey && process.env.NODE_ENV === "test") ||
    apiKey.includes("dummy") ||
    apiKey.includes("mock")
  );
}

export function getMultiHopperClient(network: SupportedNetwork = "devnet"): MultiHopperClient {
  const useMock = isMultiHopperMock();

  if (useMock) {
    return new MultiHopperClient({
      apiKey: "mh_mock_server_dev_key",
      network,
      baseUrl: "https://mock.multihopper.com/api/v1",
      fetchFn: (url, init) => globalMockServer.handleFetch(url as string, init),
      maxRetries: 2,
      initialRetryDelayMs: 20,
    });
  }

  return new MultiHopperClient({
    apiKey: process.env.MULTIHOPPER_API_KEY,
    network,
    maxRetries: 3,
  });
}


