import { describe, expect, it } from "vitest";
import { calculateDiscountedPrice, formatINR } from "./utils";

describe("pricing utilities", () => {
  it("applies percentage discount", () => {
    expect(calculateDiscountedPrice(10000, 10)).toBe(9000);
  });

  it("returns original amount when discount is zero", () => {
    expect(calculateDiscountedPrice(10000, 0)).toBe(10000);
  });

  it("formats INR minor units", () => {
    expect(formatINR(259900)).toContain("2,599");
  });
});
