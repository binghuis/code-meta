#!/usr/bin/env node
/**
 * code-meta CLI: FSD-aware scan, analyze, emit Skill resources.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cac from "cac";
import { consola } from "consola";

import { runPipeline } from "./pipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
) as { version?: string };

const cli = cac("code-meta").version(pkg.version ?? "1.0.0");
cli
  .option("--dry-run", "仅扫描与 diff，显示将要分析的目标与预估 token，不调用 API")
  .option("--emit-only", "仅从缓存重新生成 index.json 与 by-layer 分片，不调用 API")
  .option("--force", "忽略缓存，全量重新分析")
  .help();

async function runMain(
  targetPath: string | undefined,
  options: {
    dryRun?: boolean;
    emitOnly?: boolean;
    force?: boolean;
  },
): Promise<void> {
  try {
    if (options.emitOnly) {
      consola.info("Emit only: 从缓存生成项目元信息...");
      const result = await runPipeline({ emitOnly: true });
      if (!result.cacheData) {
        consola.warn("未找到缓存，请先运行一次 code-meta 进行分析。");
        process.exit(1);
      }
      consola.success("项目元信息已写入 .cursor/skills/code-meta/");
      return;
    }

    if (options.dryRun) {
      consola.info("Dry run: 扫描与 diff...");
      const result = await runPipeline({ targetPath, dryRun: true });
      if (!result.scanResult || !result.diffResult) {
        consola.warn("扫描未产生目录。");
        process.exit(0);
      }
      const { scanResult, diffResult, estimatedInputTokens = 0, estimatedOutputTokens = 0 } = result;
      consola.log(`扫描完成：${scanResult.analysisTargets.length} 个分析目标`);
      consola.log(
        `待分析：${diffResult.toAnalyze.length} 个（跳过 ${diffResult.toSkip.length}）`,
      );
      if (diffResult.toAnalyze.length > 0) {
        consola.log(
          `预估 Token：约 ${estimatedInputTokens} input，${estimatedOutputTokens} output`,
        );
      }
      return;
    }

    consola.info("运行 code-meta (FSD) 流水线...");
    const result = await runPipeline({
      targetPath,
      force: options.force ?? false,
      onProgress: (current, total, p) => {
        consola.log(`  [${current}/${total}] ${p}`);
      },
    });

    if (
      result.diffResult &&
      result.diffResult.toAnalyze.length > 0 &&
      !result.cacheData
    ) {
      consola.warn("未配置 API Key，无法进行分析。请配置 provider.apiKey。");
      process.exit(1);
    }

    consola.success("完成。项目元信息已写入 .cursor/skills/code-meta/");
  } catch (err) {
    consola.error(err);
    process.exit(1);
  }
}

const { args, options } = cli.parse();
void runMain(args[0], options as Parameters<typeof runMain>[1]);
