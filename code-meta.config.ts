import type { CodeMetaConfig } from "./src/config";

export default {
  // 文件过滤（exclude 使用默认，见 src/config.ts）
  include: ["src"],
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"],

  // 内容限制
  maxContentPerFile: 2500,
  maxTotalContent: 18000,

  // API 配置（从 .env 读取）
  arkApiKey: process.env.ARK_API_KEY,
  arkBaseUrl:
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
  arkModel: process.env.ARK_MODEL || "doubao-seed-1-8-251228",
  apiTimeout: 90000,
} satisfies CodeMetaConfig;
