/**
 * 端到端测试：在 fixture 项目上跑完整 pipeline（scan -> diff -> analyze -> emit），
 * 断言 project-meta.json 与 SKILL.md。需要配置 ARK_API_KEY（豆包）且先 npm run build。
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";

const projectRoot = path.join(__dirname, "..");
const e2eProjectDir = path.join(__dirname, "fixtures", "e2e-project");
const distCli = path.join(projectRoot, "dist", "cli.js");

function hasApiKey(): boolean {
  loadDotenv({ path: path.join(projectRoot, ".env") });
  return Boolean(process.env["ARK_API_KEY"]);
}

function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [distCli, ...args], {
      cwd: e2eProjectDir,
      env: { ...process.env },
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => (stdout += c.toString()));
    child.stderr?.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      });
    });
  });
}

describe("e2e", () => {
  beforeAll(() => {
    loadDotenv({ path: path.join(projectRoot, ".env") });
  });

  it("full pipeline: scan -> analyze -> emit (real API)", async () => {
    if (!hasApiKey()) {
      console.warn("跳过 E2E：未设置 ARK_API_KEY");
      return;
    }
    const distExists = await fs
      .access(distCli)
      .then(() => true)
      .catch(() => false);
    if (!distExists) {
      console.warn("跳过 E2E：请先执行 npm run build");
      return;
    }

    const rootEnv = path.join(projectRoot, ".env");
    const e2eEnv = path.join(e2eProjectDir, ".env");
    try {
      await fs.copyFile(rootEnv, e2eEnv);
    } catch {}

    const { exitCode, stdout, stderr } = await runCli(["--force"]);
    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }
    expect(exitCode, `CLI 应成功退出，stderr: ${stderr}`).toBe(0);

    const absE2eDir = path.resolve(e2eProjectDir);
    const skillDir = path.join(absE2eDir, ".cursor", "skills", "code-meta");
    const metaPath = path.join(skillDir, "project-meta.json");
    console.log("\n[E2E] 测试项目目录:", absE2eDir);
    console.log("[E2E] 产物:", metaPath, path.join(skillDir, "SKILL.md"), "\n");

    const cacheRaw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(cacheRaw) as {
      generatedAt: string;
      directories: Record<
        string,
        { summary: string; files: Array<{ path: string }> }
      >;
    };
    expect(meta.generatedAt).toBeDefined();
    const dirKeys = Object.keys(meta.directories);
    expect(dirKeys.length, "至少应分析 1 个目录").toBeGreaterThanOrEqual(1);

    for (const dirPath of dirKeys) {
      const entry = meta.directories[dirPath];
      expect(entry).toBeDefined();
      expect(typeof entry!.summary).toBe("string");
      expect(Array.isArray(entry!.files)).toBe(true);
      for (const f of entry!.files) {
        expect(f.path).toBeDefined();
      }
    }

    const skillMdPath = path.join(skillDir, "SKILL.md");
    const skillMd = await fs.readFile(skillMdPath, "utf8");
    expect(skillMd).toContain("project-meta.json");
  }, 120000);
});
