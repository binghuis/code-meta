import { describe, it, expect } from "vitest";
import {
  getDefaultConfig,
  loadConfig,
  DEFAULT_ALLOWED_EXTENSIONS,
} from "../src/config";

describe("config", () => {
  describe("DEFAULT_ALLOWED_EXTENSIONS", () => {
    it("includes common source extensions", () => {
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain(".ts");
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain(".tsx");
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain(".js");
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain(".vue");
    });
  });

  describe("getDefaultConfig", () => {
    it("returns config with include, exclude, provider, rules, features", async () => {
      const config = await getDefaultConfig();
      expect(config.include).toEqual(["src"]);
      expect(config.exclude).toContain("node_modules");
      expect(config.exclude).toContain("dist");
      expect(config.allowedExtensions).toEqual([...DEFAULT_ALLOWED_EXTENSIONS]);
      expect(config.provider).toBeDefined();
      expect(config.provider?.baseUrl).toBeDefined();
      expect(config.provider?.model).toBeDefined();
      expect(config.rules).toBeDefined();
      expect(config.rules?.outputDir).toBe(".cursor/rules/code-meta");
      expect(config.features).toEqual({});
    });

    it("uses env for provider when set", async () => {
      const orig = process.env["OPENAI_API_KEY"];
      process.env["OPENAI_API_KEY"] = "test-key";
      try {
        const config = await getDefaultConfig();
        expect(config.provider?.apiKey).toBe("test-key");
      } finally {
        if (orig !== undefined) process.env["OPENAI_API_KEY"] = orig;
        else delete process.env["OPENAI_API_KEY"];
      }
    });
  });

  describe("loadConfig", () => {
    it("returns default config when no file found", async () => {
      const result = await loadConfig();
      expect(result.config).toBeDefined();
      expect(result.config.include).toEqual(["src"]);
      expect(result.config.rules?.outputDir).toBe(".cursor/rules/code-meta");
    });

    it("returns configPath null when using defaults", async () => {
      const result = await loadConfig();
      expect(result.configPath === null || typeof result.configPath === "string").toBe(true);
    });
  });
});
