import JoyCon from "joycon";
import fs from "node:fs/promises";
import path from "node:path";

export interface CodeMetaConfig {
  exclude?: string[];
  allowedExtensions?: string[];
  arkApiKey?: string;
  arkBaseUrl?: string;
  arkModel?: string;
  apiTimeout?: number;
}

/** 默认参与扫描的扩展名 */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".mjs",
  ".cjs",
] as const;

/** 默认排除的目录/文件模式（不含 .gitignore 解析结果） */
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

/**
 * 读取 .gitignore 文件并解析排除规则
 */
async function parseGitignore(cwd: string): Promise<string[]> {
  try {
    const gitignorePath = path.join(cwd, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf8");

    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")) // 移除空行和注释
      .map((line) => {
        // 转换 gitignore 模式为 glob 模式
        // foo -> **/foo/**
        // foo/ -> **/foo/**
        // /foo -> foo/**
        const cleaned = line.replace(/\/$/, ""); // 移除末尾斜杠
        if (cleaned.startsWith("/")) {
          return `${cleaned.slice(1)}/**`;
        }
        return `**/${cleaned}/**`;
      });
  } catch {
    return [];
  }
}

/**
 * 创建配置加载器实例
 */
function createConfigLoader() {
  const joycon = new JoyCon({
    files: [
      "code-meta.config.ts",
      "code-meta.config.js",
      "code-meta.config.json",
      ".code-metarc",
      ".code-metarc.json",
    ],
    cwd: process.cwd(),
  });

  return joycon;
}

/**
 * 加载配置文件
 * @returns 配置对象和配置文件路径
 */
export async function loadConfig(): Promise<{
  config: CodeMetaConfig;
  configPath: string | null;
}> {
  const joycon = createConfigLoader();

  try {
    const result = await joycon.load();
    if (result) {
      const config = (result.data || {}) as CodeMetaConfig;
      const defaultConfig = await getDefaultConfig();
      return {
        config: {
          ...defaultConfig,
          ...config,
        },
        configPath: result.path || null,
      };
    }

    // 如果没有找到配置文件，返回默认配置
    return {
      config: await getDefaultConfig(),
      configPath: null,
    };
  } catch (error) {
    console.warn("Failed to load config file, using defaults:", error);
    return {
      config: await getDefaultConfig(),
      configPath: null,
    };
  }
}

/**
 * 获取默认配置
 */
export async function getDefaultConfig(): Promise<CodeMetaConfig> {
  const cwd = process.cwd();
  const gitignoreExcludes = await parseGitignore(cwd);

  return {
    exclude: [...gitignoreExcludes, ...DEFAULT_EXCLUDE],
    allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
    arkApiKey: process.env["ARK_API_KEY"],
    arkBaseUrl:
      process.env["ARK_BASE_URL"] || "https://ark.cn-beijing.volces.com/api/v3",
    arkModel: process.env["ARK_MODEL"] || "doubao-seed-1-8-251228",
    apiTimeout: 90000,
  };
}
