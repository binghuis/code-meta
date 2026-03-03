/**
 * 读取 file-manifest.json，按目录分组，在每个目录下生成 .dir-desc.json，
 * 用豆包 ARK 分析该目录下的子目录与文件，结构化输出并写入。
 *
 * 用法: tsx src/analyze-file-manifest.ts [--manifest=file-manifest.json]
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadConfig } from "./config";
import { FileDescription } from "./type";

const ROOT = process.cwd();
const DIR_DESC_FILENAME = ".dir-desc.json";
const MAX_CONTENT_PER_FILE = 2500;
const MAX_TOTAL_CONTENT = 18000;

interface SubdirDesc {
  name: string;
  desc: string;
}

interface FileDesc {
  name: string;
  desc: string;
}

interface DirAnalysisResult {
  directory: string;
  subdirs: SubdirDesc[];
  files: FileDesc[];
}

interface FileContent {
  name: string;
  content: string;
  truncated: boolean;
}

interface DirInfo {
  subdirs: Set<string>;
  files: Array<{ name: string; path: string; md5: string }>;
}

interface ArkChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const DIR_DESC_SCHEMA = {
  type: "object",
  properties: {
    directory: {
      type: "string",
      description: "该目录的功能、作用、使用场景，一段话中文",
    },
    subdirs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "子目录名" },
          desc: { type: "string", description: "一句话描述其职责，中文" },
        },
        required: ["name", "desc"],
        additionalProperties: false,
      },
      description: "直接子目录列表",
    },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "文件名" },
          desc: {
            type: "string",
            description: "一句话描述其作用或使用场景，中文",
          },
        },
        required: ["name", "desc"],
        additionalProperties: false,
      },
      description: "直接下属文件列表",
    },
  },
  required: ["directory", "subdirs", "files"],
  additionalProperties: false,
};

/** 将 manifest 按目录分组为 dir -> { subdirs, files } */
function buildDirMap(manifest: FileDescription[]): Map<string, DirInfo> {
  const dirMap = new Map<string, DirInfo>();
  const norm = (p: string) => p.replace(/\\/g, "/");

  for (const entry of manifest) {
    const fullPath = entry.path.startsWith(ROOT)
      ? path.relative(ROOT, entry.path)
      : norm(entry.path);
    const dir = path.dirname(fullPath);
    const name = path.basename(entry.path);

    if (!dirMap.has(dir)) {
      dirMap.set(dir, { subdirs: new Set(), files: [] });
    }
    dirMap.get(dir)!.files.push({ name, path: fullPath, md5: entry.md5 });

    const parts = norm(dir).split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/") || ".";
      const directChild = parts[i];
      if (directChild !== undefined) {
        if (!dirMap.has(ancestor)) {
          dirMap.set(ancestor, { subdirs: new Set(), files: [] });
        }
        dirMap.get(ancestor)!.subdirs.add(directChild);
      }
    }
  }
  return dirMap;
}

/** 读取目录下文件内容并按 maxPerFile / maxTotal 截断 */
async function collectFileContents(
  root: string,
  files: DirInfo["files"],
  maxPerFile: number,
  maxTotal: number,
): Promise<FileContent[]> {
  const result: FileContent[] = [];
  let total = 0;
  for (const f of files) {
    if (total >= maxTotal) break;
    let content = "";
    try {
      content = await fs.readFile(path.join(root, f.path), "utf8");
    } catch {
      content = "(无法读取)";
    }
    let truncated = content.length > maxPerFile;
    if (truncated) content = content.slice(0, maxPerFile);
    if (total + content.length > maxTotal) {
      content = content.slice(0, maxTotal - total);
      truncated = true;
      total = maxTotal;
    } else {
      total += content.length;
    }
    result.push({ name: f.name, content, truncated });
  }
  return result;
}

/** 调用 ARK 分析目录，返回结构化结果 */
async function analyzeDirWithApi(
  opts: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  },
  dirPath: string,
  subdirs: string[],
  fileContents: FileContent[],
): Promise<DirAnalysisResult | null> {
  const { apiKey, baseUrl, model, timeoutMs } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const subdirList = subdirs.length ? [...subdirs].sort().join("、") : "无";
  const filesSection = fileContents
    .map(
      (f) =>
        `--- 文件: ${f.name} ---\n${f.content}${f.truncated ? "\n(内容已截断)" : ""}`,
    )
    .join("\n\n");

  const userContent = `目录路径：${dirPath}

直接子目录：${subdirList}

以下为该目录下各文件的源码内容（可能截断），请根据**实际内容**分析并输出。

${filesSection}

请按约定 JSON schema 输出：directory（根据上述文件内容概括该目录的功能、作用、使用场景）、subdirs（每项 name+desc）、files（每项 name+desc，描述需基于该文件实际代码），均为中文。`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是前端项目结构分析助手。用户会给出目录路径、直接子目录列表、以及该目录下各文件的**源码内容**。请根据这些文件的**实际代码**分析并输出：directory 一段话概括该目录的功能/作用/使用场景；subdirs 数组每项 name+desc（子目录无源码时可根据名称推断）；files 数组每项 name+desc（描述必须基于该文件的实际代码）。全部中文。",
          },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dir_desc",
            schema: DIR_DESC_SCHEMA,
            strict: true,
          },
        },
        thinking: { type: "disabled" },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.text();
      let msg = `API ${res.status}: ${err}`;
      if (
        res.status === 404 &&
        /ModelNotOpen|model.*not.*activated/i.test(err)
      ) {
        msg =
          "当前 model 未开通或 ARK_MODEL 填错。请在火山方舟控制台创建推理接入点：https://console.volcengine.com/ark";
      }
      throw new Error(msg);
    }

    const data = (await res.json()) as ArkChatResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as DirAnalysisResult;
    } catch {
      return null;
    }
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") return null;
    throw e;
  }
}

export interface AnalyzeManifestOptions {
  /** manifest 文件路径，默认 <cwd>/file-manifest.json */
  manifestPath?: string;
}

/**
 * 读取 file-manifest.json 并按目录调用 ARK 分析，生成 .dir-desc.json。
 * 可在其他项目中通过 CLI 或直接调用。
 */
export async function runAnalyze(
  options: AnalyzeManifestOptions = {},
): Promise<void> {
  const { config } = await loadConfig();
  const apiKey = config.arkApiKey ?? "";
  const baseUrl =
    config.arkBaseUrl ?? "https://ark.cn-beijing.volces.com/api/v3";
  const model = config.arkModel ?? "doubao-seed-1-8-251228";
  const timeoutMs = config.apiTimeout ?? 90000;

  if (!apiKey) {
    console.error(
      "Error: ARK_API_KEY 未设置，请在 .env 或 code-meta.config 中配置。",
    );
    process.exit(1);
  }

  const manifestPath =
    options.manifestPath ??
    (() => {
      const arg = process.argv.find((a) => a.startsWith("--manifest="));
      return arg ? arg.slice(11) : path.join(ROOT, "file-manifest.json");
    })();
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as FileDescription[];
  if (!Array.isArray(manifest)) {
    throw new Error("Manifest must be an array");
  }

  const dirMap = buildDirMap(manifest);
  const dirs = [...dirMap.keys()].sort();
  console.log(
    `Analyzing ${dirs.length} directories with 豆包 ARK (${model})...`,
  );

  const apiOpts = { apiKey, baseUrl, model, timeoutMs };
  for (const dir of dirs) {
    const info = dirMap.get(dir)!;
    const descPath = path.join(ROOT, dir, DIR_DESC_FILENAME);
    const fileContents = await collectFileContents(
      ROOT,
      info.files,
      MAX_CONTENT_PER_FILE,
      MAX_TOTAL_CONTENT,
    );
    const result = await analyzeDirWithApi(
      apiOpts,
      dir,
      [...info.subdirs],
      fileContents,
    );
    if (result && typeof result.directory === "string") {
      await fs.writeFile(descPath, JSON.stringify(result, null, 2), "utf8");
      console.log(`  [${dir}] -> ${descPath}`);
    } else {
      console.log(`  [${dir}] 跳过（API 未返回或格式错误）`);
    }
  }

  console.log(
    `Done. Wrote ${DIR_DESC_FILENAME} in ${dirs.length} directories.`,
  );
}

