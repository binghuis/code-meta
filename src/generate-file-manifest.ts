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
import { FileDescription } from "./type";

const ROOT = process.cwd();

/** 只包含这些扩展名的文件（可自行增删） */
const ALLOWED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".mjs",
  ".cjs",
];

/** 排除的目录（任意层级） */
const IGNORE_DIRS = [
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
];

/** 排除的文件/模式（仅 *.config.xxx 格式的配置文件） */
const IGNORE_FILES = [
  "*.config.js",
  "*.config.ts",
  "*.config.cjs",
  "*.config.mjs",
];

/** 构建 fast-glob 的 patterns：只匹配有效源码 */
function buildPatterns(): string[] {
  return ALLOWED_EXTENSIONS.map((ext) => `**/*${ext}`);
}

/** 构建 fast-glob 的 ignore 列表 */
function buildIgnore(): string[] {
  const dirPatterns = IGNORE_DIRS.map((d) => `**/${d}/**`);
  const filePatterns = IGNORE_FILES.map((f) =>
    f.startsWith("**/") ? f : `**/${f}`,
  );
  return [...dirPatterns, ...filePatterns];
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
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? outArg.slice("--out=".length)
    : path.join(ROOT, "file-manifest.json");

  const patterns = buildPatterns();
  const ignore = buildIgnore();
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
