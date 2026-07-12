import { describe, it, expect } from "vitest";
import { formatPercent, formatPrice, shortAddress, toHexWei } from "./format";

describe("shortAddress", () => {
  it("truncates long addresses and leaves short ones alone", () => {
    const addr = "0x" + "abcdef0123456789".repeat(4);
    expect(shortAddress(addr)).toBe("0xabcd...6789");
    expect(shortAddress("0x1234")).toBe("0x1234");
  });
});

describe("formatPrice", () => {
  it("uses adaptive precision", () => {
    expect(formatPrice(1234.5)).toBe("1234.50");
    expect(formatPrice(1.2345)).toBe("1.2345");
    expect(formatPrice(0)).toBe("0");
  });
});

describe("formatPercent", () => {
  it("renders a fraction as a percentage", () => {
    expect(formatPercent(0.1234)).toBe("12.34%");
    expect(formatPercent(1)).toBe("100.00%");
  });
});

describe("toHexWei", () => {
  it("encodes a bigint as 0x-hex", () => {
    expect(toHexWei(0n)).toBe("0x0");
    expect(toHexWei(255n)).toBe("0xff");
  });
});
