/**
 * 使用 fast-glob 遍历项目，生成扁平化文件描述 JSON。
 * 扩展名与排除规则由 code-meta config 控制。
 *
 * 用法: tsx src/generate-file-manifest.ts [--out=path]
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";
import { DEFAULT_ALLOWED_EXTENSIONS, loadConfig } from "./config";
import { FileDescription } from "./type";

const ROOT = process.cwd();

function buildPatterns(extensions: string[]): string[] {
  return extensions.map((ext) => `**/*${ext}`);
}

function buildIgnore(exclude: string[]): string[] {
  return exclude.map((entry) => {
    const prefix = entry.startsWith("**/") ? "" : "**/";
    const suffix = entry.includes("*") ? "" : "/**";
    return `${prefix}${entry}${suffix}`;
  });
}

async function describeFile(filePath: string): Promise<FileDescription | null> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return null;

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    return null;
  }
  const md5 = crypto.createHash("md5").update(content).digest("hex");
  return { path: filePath, size: stat.size, md5 };
}

function getOutPath(): string {
  const arg = process.argv.find((a) => a.startsWith("--out="));
  return arg ? arg.slice(6) : path.join(ROOT, "file-manifest.json");
}

async function main(): Promise<void> {
  const { config } = await loadConfig();
  const extensions =
    (config.allowedExtensions?.length ?? 0) > 0
      ? config.allowedExtensions!
      : [...DEFAULT_ALLOWED_EXTENSIONS];
  const exclude = config.exclude ?? [];

  const outPath = getOutPath();
  const patterns = buildPatterns(extensions);
  const ignore = buildIgnore(exclude);
  const files = await fg(patterns, {
    cwd: ROOT,
    absolute: true,
    onlyFiles: true,
    ignore,
    dot: true,
    followSymbolicLinks: false,
  });

  const descriptions: FileDescription[] = [];
  for (const filePath of files) {
    const desc = await describeFile(filePath);
    if (desc) descriptions.push(desc);
  }

  await fs.writeFile(outPath, JSON.stringify(descriptions, null, 2), "utf8");
  console.log(`Wrote ${descriptions.length} entries to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
