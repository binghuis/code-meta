/**
 * 使用 fast-glob 遍历项目，生成扁平化文件描述 JSON。
 * 只包含有效源码：ts / tsx / js / jsx / vue / mjs / cjs 等。
 *
 * 用法: tsx scripts/generate-file-manifest.ts [--out=path]
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";
import { loadConfig } from "./config";
import { FileDescription } from "./type";

const ROOT = process.cwd();

/** 根据 config.allowedExtensions 构建 fast-glob 的 patterns */
function buildPatterns(extensions: string[]): string[] {
  return extensions.map((ext) => `**/*${ext}`);
}

/** 根据 config.exclude 构建 fast-glob 的 ignore 列表 */
function buildIgnore(exclude: string[]): string[] {
  return exclude.map((entry) => {
    const prefix = entry.startsWith("**/") ? "" : "**/";
    // 含 * 的视为文件模式，否则视为目录
    const suffix = entry.includes("*") ? "" : "/**";
    return `${prefix}${entry}${suffix}`;
  });
}

/**
 * @param {string} filePath - 绝对路径
 * @returns {Promise<FileDescription | null>}
 */
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

  return {
    path: filePath,
    size: stat.size,
    md5,
  };
}

async function main(): Promise<void> {
  const { config } = await loadConfig();
  const extensions = [
    ".ts",
    ".tsx",
    ".vue",
    ...(Array.isArray(config.allowedExtensions)
      ? config.allowedExtensions
      : []),
  ];
  const exclude = Array.isArray(config.exclude) ? config.exclude : [];

  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? outArg.slice("--out=".length)
    : path.join(ROOT, "file-manifest.json");

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

  const json = JSON.stringify(descriptions, null, 2);
  await fs.writeFile(outPath, json, "utf8");
  console.log(`Wrote ${descriptions.length} entries to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
