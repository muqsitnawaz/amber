import { describe, it, expect } from "vitest";
import { normalizeView } from "../src/lib/navigation";

describe("normalizeView", () => {
  it("normalizes known view strings", () => {
    expect(normalizeView("context")).toBe("context");
    expect(normalizeView("knowledge")).toBe("knowledge");
    expect(normalizeView("settings")).toBe("settings");
  });

  it("falls back to context for unknown values", () => {
    expect(normalizeView("home")).toBe("context");
    expect(normalizeView("random")).toBe("context");
    expect(normalizeView(undefined)).toBe("context");
    expect(normalizeView(null)).toBe("context");
  });
});
