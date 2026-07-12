import { describe, it, expect } from "vitest";
import {
  looksLikeAddress,
  sanitizeAmountString,
  sanitizeQuery,
  sanitizeSlippage,
  stripHostile,
} from "./sanitize";

describe("stripHostile", () => {
  it("removes zero-width and control characters", () => {
    expect(stripHostile("US\u200bDT")).toBe("USDT");
    expect(stripHostile("  hello \u0000 world  ")).toBe("hello world");
  });
});

describe("looksLikeAddress", () => {
  it("accepts 32-byte (64-hex) addresses and rejects 20-byte ones", () => {
    expect(looksLikeAddress("0x" + "a".repeat(64))).toBe(true);
    expect(looksLikeAddress("0x" + "a".repeat(40))).toBe(false);
    expect(looksLikeAddress("not-an-address")).toBe(false);
  });
});

describe("sanitizeAmountString", () => {
  it("normalizes valid decimals and clamps fractional length", () => {
    // Trailing zeros are preserved so a user can type "1.50" without fighting the field.
    expect(sanitizeAmountString("1.2300", 18)).toBe("1.2300");
    expect(sanitizeAmountString("0007.5", 18)).toBe("7.5");
    expect(sanitizeAmountString("1.123456789", 4)).toBe("1.1234");
    expect(sanitizeAmountString("100", 0)).toBe("100");
  });

  it("rejects malformed input", () => {
    expect(sanitizeAmountString("", 18)).toBeNull();
    expect(sanitizeAmountString(".", 18)).toBeNull();
    expect(sanitizeAmountString("1.2.3", 18)).toBeNull();
    expect(sanitizeAmountString("abc", 18)).toBeNull();
  });

  it("strips thousands separators and hostile chars", () => {
    expect(sanitizeAmountString("1,000.5", 18)).toBe("1000.5");
  });
});

describe("sanitizeSlippage", () => {
  it("accepts a sane range and rejects the rest", () => {
    expect(sanitizeSlippage("0.5")).toBe(0.5);
    expect(sanitizeSlippage(50)).toBe(50);
    expect(sanitizeSlippage(-1)).toBeNull();
    expect(sanitizeSlippage(51)).toBeNull();
  });
});

describe("sanitizeQuery", () => {
  it("trims hostile characters and caps length", () => {
    expect(sanitizeQuery("  he\u200bllo  ")).toBe("hello");
    expect(sanitizeQuery("x".repeat(200)).length).toBe(80);
  });
});
