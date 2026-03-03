/**
 * Configuration loading: code-meta.config.* + .gitignore parsing.
 */

import type { CodeMetaConfig, ProviderConfig, RulesConfig } from "./types";
import JoyCon from "joycon";
import fs from "node:fs/promises";
import path from "node:path";

export type { CodeMetaConfig, ProviderConfig, RulesConfig } from "./types";

/** Default extensions to scan. */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".mjs",
  ".cjs",
] as const;

/** Default exclude patterns (before .gitignore). */
const DEFAULT_EXCLUDE = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".vscode",
  ".git",
  ".husky",
  ".cache",
  "temp",
  "public",
  ".vite",
  ".turbo",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".yarn",
  "*.config.js",
  "*.config.ts",
  "*.config.cjs",
  "*.config.mjs",
] as const;

async function parseGitignore(cwd: string): Promise<string[]> {
  try {
    const gitignorePath = path.join(cwd, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const cleaned = line.replace(/\/$/, "");
        if (cleaned.startsWith("/")) {
          return `${cleaned.slice(1)}/**`;
        }
        return `**/${cleaned}/**`;
      });
  } catch {
    return [];
  }
}

function createConfigLoader() {
  return new JoyCon({
    files: [
      "code-meta.config.ts",
      "code-meta.config.js",
      "code-meta.config.json",
      ".code-metarc",
      ".code-metarc.json",
    ],
    cwd: process.cwd(),
  });
}

export interface LoadConfigResult {
  config: CodeMetaConfig;
  configPath: string | null;
}

export async function loadConfig(): Promise<LoadConfigResult> {
  const joycon = createConfigLoader();
  const defaultConfig = await getDefaultConfig();

  try {
    const result = await joycon.load();
    if (result && result.data) {
      const user = (result.data || {}) as Partial<CodeMetaConfig>;
      const config: CodeMetaConfig = {
        ...defaultConfig,
        ...user,
        provider: {
          ...defaultConfig.provider,
          ...(user.provider ?? {}),
        },
        rules: user.rules
          ? { ...defaultConfig.rules, ...user.rules }
          : defaultConfig.rules,
        features: user.features ?? defaultConfig.features,
      };
      return { config, configPath: result.path ?? null };
    }
    return { config: defaultConfig, configPath: null };
  } catch (error) {
    console.warn("Failed to load config file, using defaults:", error);
    return { config: defaultConfig, configPath: null };
  }
}

export async function getDefaultConfig(): Promise<CodeMetaConfig> {
  const cwd = process.cwd();
  const gitignoreExcludes = await parseGitignore(cwd);

  const provider: ProviderConfig = {
    baseUrl:
      process.env["ARK_BASE_URL"] ??
      process.env["OPENAI_BASE_URL"] ??
      "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env["ARK_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "",
    model:
      process.env["ARK_MODEL"] ??
      process.env["OPENAI_MODEL"] ??
      "doubao-seed-1-8-251228",
    timeout: 90000,
  };

  const rules: RulesConfig = {
    outputDir: ".cursor/rules/code-meta",
    maxRuleLength: 800,
    projectOverview: true,
  };

  return {
    include: ["src"],
    exclude: [...gitignoreExcludes, ...DEFAULT_EXCLUDE],
    allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
    provider,
    features: {},
    rules,
  };
}
