import { describe, it, expect } from "vitest";
import { estimateTokens } from "../src/provider";

describe("provider", () => {
  describe("estimateTokens", () => {
    it("estimates ~4 chars per token for English", () => {
      const text = "hello world";
      const n = estimateTokens(text);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
    });

    it("estimates ~2 chars per token for Chinese", () => {
      const text = "你好世界";
      const n = estimateTokens(text);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
    });

    it("mixed text uses both", () => {
      const text = "Hello 世界";
      const n = estimateTokens(text);
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it("empty string returns 0", () => {
      expect(estimateTokens("")).toBe(0);
    });
  });
});
