/**
 * 读取 file-manifest.json，按目录分组，在 each 目录下生成 .dir-desc.json，
 * 用豆包 ARK 分析该目录下的子目录与文件，结构化输出（目录说明、子目录、文件描述）并写入。
 *
 * 用法:
 *   tsx src/analyze-file-manifest.ts [--manifest=file-manifest.json]
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { FileDescription } from "./type";

const ROOT = process.cwd();
const API_TIMEOUT_MS = 90000;
const DIR_DESC_FILENAME = ".dir-desc.json";
const MAX_CONTENT_PER_FILE = 2500;
const MAX_TOTAL_CONTENT = 18000;

const API_KEY = process.env["ARK_API_KEY"] || "";
const BASE_URL =
  process.env["ARK_BASE_URL"] || "https://ark.cn-beijing.volces.com/api/v3";
const MODEL = process.env["ARK_MODEL"] || "doubao-seed-1-8-251228";

if (!API_KEY) {
  console.error("Error: ARK_API_KEY environment variable is not set.");
  console.error("Please set it before running this script.");
  process.exit(1);
}

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
  files: Array<{
    name: string;
    path: string;
    md5: string;
  }>;
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

/**
 * 用 AI 分析目录：根据子文件实际内容推导，结构化输出 directory、subdirs、files（json_schema）
 * fileContents: [{ name, content }]，content 已截断
 */
async function analyzeDirWithApi(
  dirPath: string,
  subdirs: string[],
  fileContents: FileContent[],
): Promise<DirAnalysisResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const subdirList = subdirs.length ? subdirs.sort().join("、") : "无";
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
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
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

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
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

async function main(): Promise<void> {
  const manifestArg = process.argv.find((a) => a.startsWith("--manifest="));
  const manifestPath = manifestArg
    ? manifestArg.slice("--manifest=".length)
    : path.join(ROOT, "file-manifest.json");

  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as FileDescription[];
  if (!Array.isArray(manifest)) {
    throw new Error("Manifest must be an array");
  }

  // 按目录分组：dir -> { subdirs: Set, files: [{ name, path, md5 }] }
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
        if (!dirMap.has(ancestor))
          dirMap.set(ancestor, { subdirs: new Set(), files: [] });
        dirMap.get(ancestor)!.subdirs.add(directChild);
      }
    }
  }

  const dirs = [...dirMap.keys()].sort();
  console.log(
    `Analyzing ${dirs.length} directories with 豆包 ARK (${MODEL})...`,
  );

  for (const dir of dirs) {
    const { subdirs, files } = dirMap.get(dir)!;
    const descPath = path.join(ROOT, dir, DIR_DESC_FILENAME);

    let total = 0;
    const fileContents: FileContent[] = [];
    for (const f of files) {
      if (total >= MAX_TOTAL_CONTENT) break;
      let content = "";
      try {
        content = await fs.readFile(path.join(ROOT, f.path), "utf8");
      } catch {
        content = "(无法读取)";
      }
      let truncated = content.length > MAX_CONTENT_PER_FILE;
      if (truncated) content = content.slice(0, MAX_CONTENT_PER_FILE);
      if (total + content.length > MAX_TOTAL_CONTENT) {
        content = content.slice(0, MAX_TOTAL_CONTENT - total);
        truncated = true;
        total = MAX_TOTAL_CONTENT;
      } else {
        total += content.length;
      }
      fileContents.push({ name: f.name, content, truncated });
    }

    const result = await analyzeDirWithApi(dir, [...subdirs], fileContents);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
