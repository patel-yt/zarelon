import { describe, expect, it } from "vitest";
import { isValidOrderTransition } from "./orderStatus";

describe("order transition rules", () => {
  it("allows pending to confirmed", () => {
    expect(isValidOrderTransition("pending", "confirmed")).toBe(true);
  });

  it("blocks delivered to shipped", () => {
    expect(isValidOrderTransition("delivered", "shipped")).toBe(false);
  });
});
