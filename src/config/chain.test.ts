import { describe, it, expect } from "vitest";
import { impersonatesStablecoin, isRecognizedAddress, WQ_ADDRESS } from "./chain";

describe("impersonatesStablecoin", () => {
  it("flags common stablecoin/fiat names and symbols", () => {
    expect(impersonatesStablecoin("USDT", "Tether USD")).toBe(true);
    expect(impersonatesStablecoin("DAI", "Dai Stablecoin")).toBe(true);
    expect(impersonatesStablecoin("EURC", "Euro Coin")).toBe(true);
    expect(impersonatesStablecoin("frax", "Frax")).toBe(true);
    expect(impersonatesStablecoin("anything", "My Stable dollar")).toBe(true);
  });

  it("allows non-stablecoin tokens", () => {
    expect(impersonatesStablecoin("HEI", "Heisen")).toBe(false);
    expect(impersonatesStablecoin("Y2Q", "Y2Q")).toBe(false);
    expect(impersonatesStablecoin("WQ", "Wrapped QuantumCoin")).toBe(false);
  });

  it("is case-insensitive and handles empty input", () => {
    expect(impersonatesStablecoin("uSd", "")).toBe(true);
    expect(impersonatesStablecoin("", "")).toBe(false);
    expect(impersonatesStablecoin(null, null)).toBe(false);
  });
});

describe("isRecognizedAddress", () => {
  it("recognizes the wrapped-Q address regardless of case", () => {
    expect(isRecognizedAddress(WQ_ADDRESS)).toBe(true);
    expect(isRecognizedAddress(WQ_ADDRESS.toLowerCase())).toBe(true);
  });

  it("rejects unknown addresses", () => {
    expect(isRecognizedAddress("0x" + "1".repeat(64))).toBe(false);
  });
});
