#!/usr/bin/env node
/**
 * code-meta CLI：在其他项目中通过 npx code-meta <command> 分步测试。
 *
 * 用法:
 *   npx code-meta generate [--out=file-manifest.json]   # 仅生成 manifest
 *   npx code-meta analyze [--manifest=file-manifest.json] # 基于 manifest 分析并写 .dir-desc.json
 */

import "dotenv/config";
import { runAnalyze } from "./analyze-file-manifest";
import { runGenerate } from "./generate-file-manifest";

const USAGE = `code-meta <command> [options]

Commands:
  generate    扫描当前项目生成 file-manifest.json（可先单独测试）
  analyze     读取 file-manifest.json，按目录调用 ARK 分析并写入 .dir-desc.json

Options:
  generate    --out=<path>        输出路径，默认 file-manifest.json
  analyze     --manifest=<path>   manifest 路径，默认 file-manifest.json

Examples:
  npx code-meta generate
  npx code-meta generate --out=./my-manifest.json
  npx code-meta analyze
  npx code-meta analyze --manifest=./my-manifest.json
`;

function parseArg(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === "generate") {
    const outPath = parseArg(args, "out");
    await runGenerate(outPath ? { outPath } : {});
    return;
  }

  if (command === "analyze") {
    const manifestPath = parseArg(args, "manifest");
    await runAnalyze(manifestPath ? { manifestPath } : {});
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error(USAGE);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
