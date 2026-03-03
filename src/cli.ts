#!/usr/bin/env node
/**
 * code-meta CLI: scan, analyze, emit Cursor rules.
 */

import "dotenv/config";
import path from "node:path";
import { consola } from "consola";
import { runPipeline } from "./pipeline";

const pkg: { version?: string } = require(
  path.join(__dirname, "..", "package.json"),
);

const USAGE = `code-meta [path] [options]

  根据源码生成 Cursor Rules，供 AI 编码助手理解项目上下文。

Commands / Options:
  [path]           可选，仅分析该路径下目录（如 src/modules/payment）
  --dry-run         仅扫描与 diff，显示将要分析的目录与预估 token，不调用 API
  --emit-only       仅从缓存重新生成 .mdc 规则文件，不调用 API
  --force           忽略缓存，全量重新分析
  --depth=N         仅分析目录深度不超过 N 层（从项目根算）
  -h, --help        显示帮助
  -v, --version     显示版本

Examples:
  npx code-meta
  npx code-meta --dry-run
  npx code-meta src/modules/payment
  npx code-meta --depth=2
  npx code-meta --emit-only
`;

function parseArgs(argv: string[]): {
  targetPath?: string;
  depth?: number;
  dryRun: boolean;
  emitOnly: boolean;
  force: boolean;
  help: boolean;
  version: boolean;
} {
  const args = argv.slice(2);
  let targetPath: string | undefined;
  let depth: number | undefined;
  let dryRun = false;
  let emitOnly = false;
  let force = false;
  let help = false;
  let version = false;

  for (const a of args) {
    if (a === "-h" || a === "--help") help = true;
    else if (a === "-v" || a === "--version") version = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--emit-only") emitOnly = true;
    else if (a === "--force") force = true;
    else if (a.startsWith("--depth=")) {
      const n = parseInt(a.slice(8), 10);
      if (!Number.isNaN(n)) depth = n;
    } else if (!a.startsWith("-")) targetPath = a;
  }

  return { targetPath, depth, dryRun, emitOnly, force, help, version };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    consola.log(USAGE);
    process.exit(0);
  }

  if (args.version) {
    consola.log(pkg.version ?? "1.0.0");
    process.exit(0);
  }

  try {
    if (args.emitOnly) {
      consola.info("Emit only: 从缓存生成规则...");
      const result = await runPipeline({
        emitOnly: true,
      });
      if (!result.cacheData) {
        consola.warn("未找到缓存，请先运行一次 code-meta 进行分析。");
        process.exit(1);
      }
      consola.success("规则已写入 .cursor/rules/code-meta/");
      return;
    }

    if (args.dryRun) {
      consola.info("Dry run: 扫描与 diff...");
      const result = await runPipeline({
        targetPath: args.targetPath,
        depth: args.depth,
        dryRun: true,
      });
      if (!result.scanResult || !result.diffResult) {
        consola.warn("扫描未产生目录。");
        process.exit(0);
      }
      const {
        scanResult,
        diffResult,
        estimatedInputTokens = 0,
        estimatedOutputTokens = 0,
      } = result;
      consola.log(`扫描完成：${scanResult.dirPaths.length} 个目录`);
      consola.log(
        `待分析：${diffResult.toAnalyze.length} 个目录（跳过 ${diffResult.toSkip.length}）`,
      );
      if (diffResult.toAnalyze.length > 0) {
        consola.log(
          `预估 Token：约 ${estimatedInputTokens} input，${estimatedOutputTokens} output`,
        );
        consola.log(
          "执行 code-meta（不加 --dry-run）将调用 API 并写入缓存与规则。",
        );
      }
      return;
    }

    consola.info("运行 code-meta 流水线...");
    const result = await runPipeline({
      targetPath: args.targetPath,
      depth: args.depth,
      force: args.force,
      onProgress: (current, total, dirPath) => {
        consola.log(`  [${current}/${total}] ${dirPath}`);
      },
    });

    if (
      result.diffResult &&
      result.diffResult.toAnalyze.length > 0 &&
      !result.cacheData
    ) {
      consola.warn(
        "未配置 API Key，无法进行分析。请在 .env 或 code-meta.config 中配置 provider.apiKey。",
      );
      process.exit(1);
    }

    consola.success("完成。规则已写入 .cursor/rules/code-meta/");
  } catch (err) {
    consola.error(err);
    process.exit(1);
  }
}

main();
