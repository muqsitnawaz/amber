import { describe, it, expect } from "vitest";
import { normalizeView } from "../src/lib/navigation";

describe("normalizeView", () => {
  it("normalizes known view strings", () => {
    expect(normalizeView("wiki")).toBe("wiki");
    expect(normalizeView("context")).toBe("context");
    expect(normalizeView("knowledge")).toBe("knowledge");
    expect(normalizeView("settings")).toBe("settings");
  });

  it("falls back to wiki for unknown values", () => {
    expect(normalizeView("home")).toBe("wiki");
    expect(normalizeView("random")).toBe("wiki");
    expect(normalizeView(undefined)).toBe("wiki");
    expect(normalizeView(null)).toBe("wiki");
  });
});
