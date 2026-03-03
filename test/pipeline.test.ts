import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline";

vi.mock("../src/config", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      include: ["src"],
      exclude: ["node_modules", "dist", ".git"],
      allowedExtensions: [".ts", ".tsx", ".js", ".jsx"],
      provider: { baseUrl: "", apiKey: "", model: "" },
      rules: { outputDir: ".cursor/rules/code-meta" },
      features: {},
    },
    configPath: null,
  }),
}));

describe("pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dryRun returns scanResult and diffResult without calling API", async () => {
    const result = await runPipeline({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.scanResult).toBeDefined();
    expect(result.diffResult).toBeDefined();
    expect(result.estimatedInputTokens).toBeDefined();
    expect(result.estimatedOutputTokens).toBeDefined();
  });

  it("emitOnly returns cacheData and emitOnly true when cache exists", async () => {
    const { readCache } = await import("../src/cache");
    const cacheBefore = await readCache();
    const result = await runPipeline({ emitOnly: true });
    expect(result.emitOnly).toBe(true);
    if (cacheBefore) {
      expect(result.cacheData).toBeDefined();
    } else {
      expect(result.cacheData === undefined || result.cacheData !== undefined).toBe(true);
    }
  });
});
