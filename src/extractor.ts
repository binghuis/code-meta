/**
 * Smart source code extraction: comments, exports, signatures before raw truncation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./constants";

export interface ExtractedFile {
  name: string;
  content: string;
  truncated: boolean;
}

const MAX_PER_FILE = 2000;
const MAX_TOTAL = 15000;

function extractLeadingComment(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/**") || trimmed.startsWith("/*")) {
      inBlock = true;
      out.push(line);
      if (trimmed.includes("*/")) break;
      continue;
    }
    if (inBlock) {
      out.push(line);
      if (trimmed.endsWith("*/")) break;
      continue;
    }
    if (trimmed.startsWith("//")) {
      out.push(line);
      continue;
    }
    break;
  }
  return out.join("\n");
}

function extractExportsAndSignatures(content: string, budget: number): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let count = 0;
  let inExport = false;
  let braceDepth = 0;
  for (const line of lines) {
    if (count >= budget) break;
    const trimmed = line.trim();
    if (
      trimmed.startsWith("export ") ||
      trimmed.startsWith("export type ") ||
      trimmed.startsWith("export interface ") ||
      trimmed.startsWith("export enum ")
    ) {
      inExport = true;
      braceDepth = 0;
      const openBraces = (line.match(/{/g) ?? []).length;
      const closeBraces = (line.match(/}/g) ?? []).length;
      braceDepth += openBraces - closeBraces;
      out.push(line);
      count += line.length + 1;
      if (braceDepth <= 0) inExport = false;
      continue;
    }
    if (inExport) {
      out.push(line);
      count += line.length + 1;
      const openBraces = (line.match(/{/g) ?? []).length;
      const closeBraces = (line.match(/}/g) ?? []).length;
      braceDepth += openBraces - closeBraces;
      if (braceDepth <= 0) inExport = false;
      continue;
    }
    if (
      (trimmed.startsWith("interface ") ||
        trimmed.startsWith("type ") ||
        trimmed.startsWith("function ") ||
        trimmed.startsWith("const ") ||
        trimmed.startsWith("class ")) &&
      (trimmed.includes("export") || out.length === 0)
    ) {
      out.push(line);
      count += line.length + 1;
    }
  }
  return out.join("\n").slice(0, budget) || content.slice(0, budget);
}

export async function extractFileContent(
  relPath: string,
  budget: number = MAX_PER_FILE,
): Promise<{ content: string; truncated: boolean }> {
  const abs = path.join(ROOT, relPath);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return { content: "(无法读取)", truncated: false };
  }

  const comment = extractLeadingComment(content);
  const restBudget = budget - comment.length;
  const body = extractExportsAndSignatures(content, restBudget > 0 ? restBudget : 0);
  const combined = comment.trim() ? `${comment}\n\n${body}` : body;
  const truncated = content.length > budget;
  return {
    content: combined.length > budget ? combined.slice(0, budget) : combined,
    truncated,
  };
}

export async function extractDirectoryContents(
  files: Array<{ name: string; path: string }>,
  maxPerFile: number = MAX_PER_FILE,
  maxTotal: number = MAX_TOTAL,
): Promise<ExtractedFile[]> {
  const extractions = await Promise.all(
    files.map((f) => extractFileContent(f.path, maxPerFile)),
  );
  const result: ExtractedFile[] = [];
  let total = 0;
  for (let i = 0; i < files.length; i++) {
    if (total >= maxTotal) break;
    const f = files[i]!;
    const { content, truncated } = extractions[i]!;
    const budget = maxTotal - total;
    const slice = content.length <= budget ? content : content.slice(0, budget);
    result.push({
      name: f.name,
      content: slice,
      truncated: truncated || content.length > budget,
    });
    total += slice.length;
  }
  return result;
}
