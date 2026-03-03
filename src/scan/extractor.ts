/**
 * Smart source code extraction: comments, exports, signatures before raw truncation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Project } from "ts-morph";
import { ROOT } from "../core/constants";

const tsMorphProject = new Project({ useInMemoryFileSystem: true });
let extractFileCounter = 0;

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
  if (budget <= 0) return content.slice(0, budget);
  const virtualName = `_extract_${++extractFileCounter}.ts`;
  try {
    const sourceFile = tsMorphProject.createSourceFile(virtualName, content, {
      overwrite: true,
    });
    const exported = sourceFile.getExportedDeclarations();
    const seen = new Set<unknown>();
    const parts: string[] = [];
    let total = 0;
    for (const decls of exported.values()) {
      for (const d of decls) {
        if (seen.has(d)) continue;
        seen.add(d);
        const text = d.getText();
        if (total + text.length + 1 > budget) break;
        parts.push(text);
        total += text.length + 1;
      }
      if (total >= budget) break;
    }
    const result = parts.join("\n").slice(0, budget);
    tsMorphProject.removeSourceFile(sourceFile);
    return result || content.slice(0, budget);
  } catch {
    return content.slice(0, budget);
  }
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
