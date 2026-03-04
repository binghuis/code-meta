import type { CodeMetaConfig } from "./src/core/types";

export default {
  srcRoot: "src",
  provider: {
    baseUrl:
      process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env.ARK_API_KEY ?? "",
    model: process.env.ARK_MODEL ?? "doubao-seed-1-8-251228",
    timeout: 90000,
  },
} satisfies CodeMetaConfig;
