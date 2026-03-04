/**
 * Smart file content extraction using ts-morph for exports/signatures.
 * Also provides extractPublicApi for slice index files.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { Project, SyntaxKind } from "ts-morph";

import { ROOT } from "../core/constants";

const MAX_PER_FILE = 2000;
const MAX_TOTAL = 15_000;

// ── ts-morph project (lazy singleton) ───────────────────────────

let _project: Project | null = null;
function getProject(): Project {
  if (!_project) {
    _project = new Project({ compilerOptions: { allowJs: true }, skipAddingFilesFromTsConfig: true });
  }
  return _project;
}

// ── leading comment extraction ──────────────────────────────────

function extractLeadingComment(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (inBlock) {
      result.push(line);
      if (trimmed.includes("*/")) { inBlock = false; }
      continue;
    }
    if (trimmed.startsWith("/**") || trimmed.startsWith("/*")) {
      inBlock = !trimmed.includes("*/");
      result.push(line);
      continue;
    }
    if (trimmed.startsWith("//")) {
      result.push(line);
      continue;
    }
    break;
  }
  return result.join("\n");
}

// ── export/signature extraction via ts-morph ────────────────────

function extractExportsAndSignatures(absPath: string, budget: number): string {
  try {
    const project = getProject();
    const sourceFile = project.addSourceFileAtPath(absPath);
    const parts: string[] = [];
    let used = 0;

    for (const [, declarations] of sourceFile.getExportedDeclarations()) {
      for (const decl of declarations) {
        let text: string;
        if (
          decl.getKind() === SyntaxKind.FunctionDeclaration ||
          decl.getKind() === SyntaxKind.ClassDeclaration
        ) {
          text = decl.getText().slice(0, 300);
        } else {
          text = decl.getText().slice(0, 200);
        }
        if (used + text.length > budget) break;
        parts.push(text);
        used += text.length;
      }
      if (used >= budget) break;
    }

    project.removeSourceFile(sourceFile);
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

// ── public API ──────────────────────────────────────────────────

export interface ExtractedFile {
  name: string;
  content: string;
  truncated: boolean;
}

/**
 * Extract smart content from a single file (comment + exports/signatures).
 */
export async function extractFileContent(
  relPath: string,
  budget: number = MAX_PER_FILE,
): Promise<{ content: string; truncated: boolean }> {
  const absPath = path.join(ROOT, relPath);
  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch {
    return { content: "(无法读取)", truncated: false };
  }

  if (raw.length <= budget) {
    return { content: raw, truncated: false };
  }

  const comment = extractLeadingComment(raw);
  const remaining = Math.max(0, budget - comment.length - 10);
  const body = extractExportsAndSignatures(absPath, remaining);

  const combined = body ? `${comment}\n\n${body}` : comment;
  return {
    content: combined.slice(0, budget),
    truncated: combined.length > budget || raw.length > budget,
  };
}

/**
 * Extract content for multiple files (for one slice / direct-layer).
 */
export async function extractDirectoryContents(
  files: Array<{ name: string; path: string }>,
  maxPerFile: number = MAX_PER_FILE,
  maxTotal: number = MAX_TOTAL,
): Promise<ExtractedFile[]> {
  const results: ExtractedFile[] = [];
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= maxTotal) break;
    const budget = Math.min(maxPerFile, maxTotal - totalChars);
    const { content, truncated } = await extractFileContent(file.path, budget);
    results.push({ name: file.name, content, truncated });
    totalChars += content.length;
  }

  return results;
}

/**
 * Extract public API names from a slice's index file (re-exports).
 */
export async function extractPublicApi(indexRelPath: string): Promise<string[]> {
  const absPath = path.join(ROOT, indexRelPath);
  try {
    await fs.access(absPath);
  } catch {
    return [];
  }

  try {
    const project = getProject();
    const sourceFile = project.addSourceFileAtPath(absPath);
    const names: string[] = [];

    for (const [name] of sourceFile.getExportedDeclarations()) {
      names.push(name);
    }

    project.removeSourceFile(sourceFile);
    return names;
  } catch {
    return [];
  }
}
